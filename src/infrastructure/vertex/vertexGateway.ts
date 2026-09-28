import { GoogleGenAI } from '@google/genai';
import { SYSTEM_PROMPT } from '@application/ports/ports';
import type { TextStreamGateway } from '@application/ports/ports';
import { measureThroughput } from '@domain/entities/throughput';

/**
 * Gemini Flash sur Vertex AI — le nuage du duel.
 * ⚠️ VERTEX_MODEL : figer l'identifiant exact vérifié via
 * `gcloud ai models list` (default : alias glissant « gemini-flash-latest »).
 */
export function makeVertexGateway(opts: {
  projectId: string;
  location: string;
  model: string;
  maxOutputTokens?: number;
}): TextStreamGateway {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: opts.projectId,
    location: opts.location,
  });

  return {
    async stream(prompt, onChunk) {
      const startedAt = Date.now();
      let fullText = '';
      let firstTokenAt: number | null = null;
      let lastTokenAt: number | null = null;
      let completionTokens = 0;

      const stream = await ai.models.generateContentStream({
        model: opts.model,
        contents: [{ role: 'user' as const, parts: [{ text: prompt }] }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          maxOutputTokens: opts.maxOutputTokens ?? 1024,
        },
      });

      for await (const chunk of stream) {
        const usage = (chunk as { usageMetadata?: { candidatesTokenCount?: number } }).usageMetadata
          ?.candidatesTokenCount;
        if (typeof usage === 'number' && usage > 0) completionTokens = usage;
        const piece = chunk.text ?? '';
        if (!piece) continue;
        const now = Date.now();
        if (firstTokenAt === null) firstTokenAt = now;
        lastTokenAt = now;
        fullText += piece;
        onChunk(piece);
      }

      const t = measureThroughput({ startedAtMs: startedAt, firstTokenAtMs: firstTokenAt, lastTokenAtMs: lastTokenAt, completionTokens, fullText });
      return { tokPerSec: t.tokPerSec, ttftMs: t.ttftMs ?? undefined, fullText };
    },
  };
}
