// Builder — le root de composition. Toute la câblerie vit ici ; le reste
// ignore l'infrastructure. `MEMORY_STORE=true` (ou pièces injectées) pour
// tourner sans GCP : tests et dev local.
import type { Clock, RateLimiter, RoundRepository, StatsRepository, TextStreamGateway } from '@application/ports/ports';
import { makeGetLeaderboardUseCase, makeCastVoteUseCase } from '@application/usecases/voteAndLeaderboard';
import { makeStartRoundUseCase } from '@application/usecases/playRound';
import { RoundQueue, type QueueStatus } from '@application/queue/roundQueue';
import { makeGetMacStatsUseCase } from '@application/usecases/macTelemetry';
import { makeMacosMonitor } from '@infrastructure/system/macosMonitor';
import { MemoryRoundRepository, MemoryStatsRepository, SlidingWindowRateLimiter, fakeStreamGateway, systemClock } from '@infrastructure/http/inMemory';
import { FirestoreRoundRepository, FirestoreStatsRepository } from '@infrastructure/firestore/firestoreStores';
import { makeVertexGateway } from '@infrastructure/vertex/vertexGateway';
import { makeOmlxDirectGateway } from '@infrastructure/omlx/omlxDirectGateway';

export interface AppConfig {
  maxRoundsPerDay: number;
  perIpPerWindow: number;
  windowMs: number;
  vertex: { projectId: string; location: string; model: string };
  /** oMLX sur le Mac. Absent → la piste Mac est déclarée hors ligne. */
  omlx?: { baseUrl: string; model: string };
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    maxRoundsPerDay: Number(env.MAX_ROUNDS_PER_DAY ?? 150),
    perIpPerWindow: Number(env.PER_IP_PER_WINDOW ?? 5),
    windowMs: Number(env.WINDOW_MS ?? 60_000),
    vertex: {
      projectId: env.VERTEX_PROJECT_ID ?? '',
      location: env.VERTEX_LOCATION ?? 'global',
      model: env.VERTEX_MODEL ?? 'gemini-flash-latest', // à figer après `gcloud ai models list`
    },
    // LOCAL_MODEL posé → le serveur parle directement à l'API oMLX.
    omlx: env.LOCAL_MODEL ? { baseUrl: env.OMLX_URL ?? 'http://127.0.0.1:8000', model: env.LOCAL_MODEL } : undefined,
  };
}

export interface App {
  config: AppConfig;
  startRound: ReturnType<typeof makeStartRoundUseCase>;
  castVote: ReturnType<typeof makeCastVoteUseCase>;
  getLeaderboard: ReturnType<typeof makeGetLeaderboardUseCase>;
  /** Le Mac répond-il ? (vérifié au plus toutes les 20 s). */
  macOnline: () => Promise<boolean>;
  getMacStats: ReturnType<typeof makeGetMacStatsUseCase>;
  getRound: (id: string) => ReturnType<RoundRepository['get']>;
  queueStatus: (id?: string) => QueueStatus;
  subscribeRound: (id: string, cb: Parameters<RoundRepository['subscribe']>[1]) => () => void;
}

export interface BuilderParts {
  rounds?: RoundRepository;
  stats?: StatsRepository;
  rateLimiter?: RateLimiter;
  clock?: Clock;
  cloud?: TextStreamGateway;
}

// Chaque route Next est bundlée séparément : sans singleton global, deux
// routes en mémoire n'auraient pas la même manche. L'état mémoire survit
// donc sur globalThis (jamais nécessaire en prod, Firestore y pourvoit).
const globals = globalThis as unknown as {
  __devine_rounds?: RoundRepository;
  __devine_stats?: StatsRepository;
  __devine_queue?: RoundQueue;
};

/** Construit l'application ; les pièces injectées écrasent l'environnement. */
export function buildApp(env: NodeJS.ProcessEnv = process.env, parts: BuilderParts = {}): App {
  const config = configFromEnv(env);
  const memory = parts.rounds !== undefined || env.MEMORY_STORE === 'true' || !env.GCLOUD_PROJECT;

  const rounds = parts.rounds ?? (memory
    ? (globals.__devine_rounds ??= new MemoryRoundRepository())
    : new FirestoreRoundRepository());
  const stats = parts.stats ?? (memory
    ? (globals.__devine_stats ??= new MemoryStatsRepository())
    : new FirestoreStatsRepository());
  const clock = parts.clock ?? systemClock();
  const cloud = parts.cloud ?? (config.vertex.projectId
    ? makeVertexGateway(config.vertex)
    // Placeholder de dev (jamais en prod, Vertex y est configuré) — texte
    // volontairement neutre : il ne doit pas trahir le côté nuage du duel.
    : fakeStreamGateway('Chargement en cours depuis l’autre bout du fil… les deux répondent, à toi de deviner laquelle.', 0, 90, 700));
  const omlx = config.omlx ? safeOmlx(config.omlx) : undefined;
  const local = omlx ?? offlineGateway;
  // Une seule file pour toutes les routes du processus (même raison que les
  // dépôts mémoire ci-dessus : chaque route est bundlée à part).
  const queue = parts.rounds ? new RoundQueue(1) : (globals.__devine_queue ??= new RoundQueue(1));

  return {
    config,
    startRound: makeStartRoundUseCase({
      clock,
      rateLimiter: parts.rateLimiter ?? new SlidingWindowRateLimiter(config.perIpPerWindow, config.windowMs),
      rounds,
      stats,
      cloud,
      local,
      maxRoundsPerDay: config.maxRoundsPerDay,
      queue,
    }),
    castVote: makeCastVoteUseCase({ rounds, stats, clock }),
    getLeaderboard: makeGetLeaderboardUseCase({ rounds, stats }),
    macOnline: cachedPing(omlx),
    // La télémétrie n'existe que là où le serveur tourne sur le Mac.
    getMacStats: makeGetMacStatsUseCase({ monitor: makeMacosMonitor(), enabled: !!omlx }),
    getRound: (id) => rounds.get(id),
    queueStatus: (id) => queue.status(id),
    subscribeRound: (id, cb) => rounds.subscribe(id, cb),
  };
}

/** Sans clé oMLX, on démarre quand même : la piste Mac sera hors ligne. */
function safeOmlx(cfg: { baseUrl: string; model: string }): TextStreamGateway | undefined {
  try {
    return makeOmlxDirectGateway(cfg);
  } catch (err) {
    console.warn('oMLX indisponible, piste Mac hors ligne :', String(err));
    return undefined;
  }
}

/** Piste Mac sans oMLX configuré : échoue tout de suite, le nuage joue seul. */
const offlineGateway: TextStreamGateway = {
  async stream() { throw new Error('Mac hors ligne'); },
};

function cachedPing(gateway?: TextStreamGateway) {
  let last = { atMs: 0, online: false };
  return async () => {
    if (!gateway?.ping) return !!gateway;
    if (Date.now() - last.atMs < 20_000) return last.online;
    last = { atMs: Date.now(), online: await gateway.ping().catch(() => false) };
    return last.online;
  };
}
