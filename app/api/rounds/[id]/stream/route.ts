import { NextRequest } from 'next/server';
import { buildApp } from '@/main/builder';

export const runtime = 'nodejs';
const app = buildApp();

/** SSE : état de la manche, place dans la file et textes des deux pistes. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const round = await app.getRound(id);
  if (!round) return new Response('manche introuvable', { status: 404 });

  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      // Deux couloirs écrivent en parallèle : le second peut arriver après
      // la fermeture du stream (manche déjà terminal). enqueue alors lève
      // ERR_INVALID_STATE — on ignore ces notifications tardives.
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { closed = true; }
      };

      const heartbeat = setInterval(() => send(': ping', ''), 15_000);
      // Place dans la file, poussée chaque seconde tant que la manche attend.
      let queued = round.machine.state === 'queued';
      const queueTick = setInterval(() => { if (queued) send('queue', app.queueStatus(id)); }, 1000);
      const payload = (r: typeof round) =>
        ({ machine: r.machine, cloudText: r.cloudText, localText: r.localText, vote: r.vote, macSide: r.macSide });
      unsub = app.subscribeRound(id, (r) => {
        queued = r.machine.state === 'queued';
        send('round', payload(r));
        if (r.machine.state === 'revealed' || r.machine.state === 'expired' || r.machine.state === 'failed') {
          clearInterval(heartbeat);
          clearInterval(queueTick);
          if (!closed) { closed = true; try { controller.close(); } catch { /* déjà fermé */ } }
          unsub?.();
        }
      });
      send('round', payload(round));
      if (queued) send('queue', app.queueStatus(id));
      cleanup = () => { clearInterval(heartbeat); clearInterval(queueTick); unsub?.(); };
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
