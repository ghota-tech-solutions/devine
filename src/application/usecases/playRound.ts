import { normalizePrompt, rollMacSide, QuotaExhaustedError } from '@domain/entities/round';
import { initialRoundState, transition } from '@domain/states/roundStateMachine';
import type { Round } from '@domain/entities/round';
import type { Clock, RateLimiter, RoundRepository, StatsRepository, TextStreamGateway } from '@application/ports/ports';
import { RoundQueue } from '@application/queue/roundQueue';

export interface StartRoundDeps {
  clock: Clock;
  rateLimiter: RateLimiter;
  rounds: RoundRepository;
  /** Agrégats durables (le TTL des manches ne doit pas emporter les stats). */
  stats?: StatsRepository;
  cloud: TextStreamGateway;
  /** oMLX sur le Mac, appelé par le serveur. */
  local: TextStreamGateway;
  maxRoundsPerDay: number;
  /** Intervalle minimal entre deux écritures Firestore du stream cloud. */
  flushIntervalMs?: number;
  /** File partagée (une manche à la fois par défaut). */
  queue?: RoundQueue;
  /** Au-delà, une manche qui n'a pas fini ses deux pistes libère la file. */
  roundTimeoutMs?: number;
  /** Le nuage part quand le Mac écrit son premier mot ; au plus tard après ce délai. */
  cloudMaxDelayMs?: number;
}

export interface StartRoundResult {
  roundId: string;
  /** 0 = démarre tout de suite, n = n-ième en attente dans la file. */
  queuePosition: number;
}

const SETTLED = ['awaiting_vote', 'revealed', 'expired', 'failed'];

/**
 * Crée une manche : contrôles d'entrée, contingent global, anti-abus IP, puis
 * mise en file. À son tour, les deux pistes (oMLX sur le Mac, Vertex AI)
 * streament en arrière-plan, relayées par le serveur.
 */
export function makeStartRoundUseCase(deps: StartRoundDeps) {
  const flushMs = deps.flushIntervalMs ?? 150;
  const queue = deps.queue ?? new RoundQueue(1);
  const timeoutMs = deps.roundTimeoutMs ?? 180_000;
  const cloudMaxDelayMs = deps.cloudMaxDelayMs ?? 10_000;

  return async function startRound(input: { prompt: string; ip: string }): Promise<StartRoundResult> {
    const prompt = normalizePrompt(input.prompt);

    deps.rateLimiter.consume(input.ip, deps.clock.nowMs());

    const day = deps.clock.day();
    const count = await deps.rounds.incrementDailyCounter(day);
    if (count > deps.maxRoundsPerDay) throw new QuotaExhaustedError();

    const id = crypto.randomUUID();
    const macSide = rollMacSide();
    await deps.rounds.create({
      id,
      macSide,
      createdAtMs: deps.clock.nowMs(),
      prompt,
      localText: '',
      cloudText: '',
      machine: initialRoundState(),
    });

    const queuePosition = queue.enqueue(id, () => launch(id, prompt));
    return { roundId: id, queuePosition };
  };

  /** Tour venu : démarre les pistes, garde la place jusqu'à ce qu'elles aient fini. */
  async function launch(id: string, prompt: string) {
    const round = await deps.rounds.get(id);
    if (!round) return;
    await deps.rounds.update(id, { machine: transition(round.machine, { type: 'START' }) });

    // Le Mac part d'abord : son premier mot arrive plus tard (réflexion, trajet
    // jusqu'à la box). Le nuage ne démarre qu'à ce moment-là, pour que les deux
    // réponses commencent à s'écrire ensemble. Si le Mac échoue ou tarde trop,
    // le nuage part quand même.
    let cloudStarted = false;
    const startCloud = () => {
      if (cloudStarted) return;
      cloudStarted = true;
      clearTimeout(fallback);
      void runStreamInBackground(id, prompt, deps.cloud, 'cloud');
    };
    const fallback = setTimeout(startCloud, cloudMaxDelayMs);
    (fallback as { unref?: () => void }).unref?.();
    void runStreamInBackground(id, prompt, deps.local, 'local', startCloud);
    await waitUntilSettled(id);
  }

  function waitUntilSettled(id: string) {
    return new Promise<void>((resolve) => {
      let unsub = () => {};
      const finish = () => { clearTimeout(timer); unsub(); resolve(); };
      const timer = setTimeout(async () => {
        const r = await deps.rounds.get(id);
        if (r && !SETTLED.includes(r.machine.state)) {
          await deps.rounds.update(id, { machine: transition(r.machine, { type: 'EXPIRE' }) }).catch(() => {});
        }
        finish();
      }, timeoutMs);
      // Un Mac muet ne doit pas bloquer la file pour toujours, mais ce minuteur
      // ne doit pas non plus retenir le processus (tests, arrêt propre).
      (timer as { unref?: () => void }).unref?.();
      unsub = deps.rounds.subscribe(id, (r) => { if (SETTLED.includes(r.machine.state)) finish(); });
      void deps.rounds.get(id).then((r) => { if (r && SETTLED.includes(r.machine.state)) finish(); });
    });
  }

  async function runStreamInBackground(
    id: string,
    prompt: string,
    gateway: TextStreamGateway,
    lane: 'local' | 'cloud',
    /** Appelé au premier texte reçu, ou à la fin de la piste si rien n'est venu. */
    onFirstText?: () => void,
  ) {
    const textKey = lane === 'local' ? 'localText' : 'cloudText';
    const doneEvent = lane === 'local'
      ? (tps: number, ttftMs?: number) => ({ type: 'LOCAL_DONE' as const, tokPerSec: tps, ttftMs })
      : (tps: number, ttftMs?: number) => ({ type: 'CLOUD_DONE' as const, tokPerSec: tps, ttftMs });

    // Les écritures sont sérialisées : aucun flush ne peut écraser l'écriture
    // finale (le texte complet) ni se faire écraser par elle.
    let chain: Promise<void> = Promise.resolve();
    let buffered = '';
    let lastFlush = 0;

    const enqueue = (fn: () => Promise<void>) => {
      chain = chain.then(fn, fn);
      return chain;
    };
    const flush = (force = false) => {
      if (!buffered) return chain;
      const now = deps.clock.nowMs();
      if (!force && now - lastFlush < flushMs) return chain;
      const chunk = buffered;
      buffered = '';
      lastFlush = now;
      return enqueue(async () => {
        const round = await deps.rounds.get(id);
        if (!round) return;
        await deps.rounds.update(id, { [textKey]: round[textKey] + chunk } as Partial<Round>);
      });
    };

    try {
      const { tokPerSec, ttftMs, fullText, reasoning } = await gateway.stream(prompt, (chunk) => {
        if (chunk) onFirstText?.();
        buffered += chunk;
        void flush();
      });
      await flush(true);
      await enqueue(async () => {
        const round = await deps.rounds.get(id);
        if (!round) return;
        await deps.rounds.update(id, {
          [textKey]: fullText,
          ...(lane === 'local' && reasoning ? { localReasoning: reasoning } : {}),
          machine: transition(round.machine, doneEvent(tokPerSec, ttftMs)),
        } as Partial<Round>);
        // L'agrégat survit au TTL des manches — fire and forget, une stats
        // qui tombe ne doit jamais casser une manche jouée.
        await deps.stats?.recordLaneDone(deps.clock.day(), lane, tokPerSec).catch(() => {});
      });
    } catch (err) {
      console.warn(`couloir ${lane} en échec :`, String(err));
      await enqueue(async () => {
        const round = await deps.rounds.get(id);
        if (!round) return;
        await deps.rounds.update(id, {
          machine: transition(round.machine, { type: 'LANE_FAIL', lane, reason: String(err) }),
        });
      });
    } finally {
      onFirstText?.(); // piste finie ou en panne sans texte : ne jamais bloquer l'autre
    }
  }
}
