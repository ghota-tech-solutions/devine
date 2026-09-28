import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SYSTEM_PROMPT } from '@application/ports/ports';
import type { TextStreamGateway } from '@application/ports/ports';
import { measureThroughput } from '@domain/entities/throughput';

/**
 * Passerelle vers oMLX : le serveur parle à l'API OpenAI-compatible de oMLX.
 * La clé est lue dans ~/.omlx/settings.json, jamais dans une requête entrante.
 */
export function makeOmlxDirectGateway(opts: {
  baseUrl: string; // ex. http://127.0.0.1:8000
  model: string; // alias servi oMLX
}): TextStreamGateway {
  let apiKey = process.env.OMLX_API_KEY ?? '';
  if (!apiKey) {
    try {
      const settings = JSON.parse(readFileSync(join(homedir(), '.omlx', 'settings.json'), 'utf8'));
      apiKey = settings.auth?.api_key ?? '';
    } catch {
      throw new Error('clé oMLX introuvable (~/.omlx/settings.json)');
    }
  }

  return {
    async stream(prompt, onChunk) {
      const startedAt = Date.now();
      let fullText = '';
      let firstTokenAt: number | null = null;
      let lastTokenAt: number | null = null;
      let completionTokens = 0;

      // Le signal ne protège que l'établissement de la connexion : derrière une
      // NAT qui droppe les paquets sans refuser, un fetch sans délai pendrait
      // la manche entière. Le corps du stream, lui, n'est pas abrégé.
      const ac = new AbortController();
      const connectTimer = setTimeout(() => ac.abort(), 15_000);
      const res = await fetch(`${opts.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: ac.signal,
        body: JSON.stringify({
          model: opts.model,
          stream: true,
          // oMLX (OpenAI-compatible) renvoie le compte réel de tokens dans le
          // dernier chunk — seule façon de compter des tokens, pas des mots.
          stream_options: { include_usage: true },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
        }),
      });
      clearTimeout(connectTimer);
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new Error(`oMLX ${res.status} : ${detail.slice(0, 200)}`);
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const usage = json.usage?.completion_tokens;
            if (typeof usage === 'number' && usage > 0) completionTokens = usage;
            const piece: string = json.choices?.[0]?.delta?.content ?? '';
            if (piece) {
              const now = Date.now();
              if (firstTokenAt === null) firstTokenAt = now;
              lastTokenAt = now;
              fullText += piece;
              onChunk(piece);
            }
          } catch { /* keep-alive */ }
        }
      }

      // Fenêtre de décode uniquement (comme le tableau de bord oMLX) :
      // file d'attente et prefill sortent du ratio, ils ressortent en TTFT.
      const t = measureThroughput({ startedAtMs: startedAt, firstTokenAtMs: firstTokenAt, lastTokenAtMs: lastTokenAt, completionTokens, fullText });
      return { tokPerSec: t.tokPerSec, ttftMs: t.ttftMs ?? undefined, fullText };
    },

    async ping() {
      try {
        const res = await fetch(`${opts.baseUrl}/v1/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(2500),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
