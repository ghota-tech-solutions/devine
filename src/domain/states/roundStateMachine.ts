// Machine à états de la manche — pur, sans dépendance, testable table par table.
//
//   queued ──START──▶ live ──BOTH_DONE──▶ awaiting_vote ──VOTE──▶ revealed
//      │                │
//      └──EXPIRE───────┴──EXPIRE──▶ expired   (tout état non terminal)

export type RoundState =
  | 'queued'
  | 'live'
  | 'awaiting_vote'
  | 'revealed'
  | 'expired'
  | 'failed';

export type RoundEvent =
  | { type: 'START' }
  | { type: 'LOCAL_DONE'; tokPerSec: number; ttftMs?: number }
  | { type: 'CLOUD_DONE'; tokPerSec: number; ttftMs?: number }
  /** Un couloir meurt : la manche survit si l'autre couloir répond. */
  | { type: 'LANE_FAIL'; lane: 'local' | 'cloud'; reason: string }
  | { type: 'VOTE'; choice: 'left' | 'right' | 'tie'; correct: boolean }
  | { type: 'EXPIRE' }
  | { type: 'FAIL'; reason: string };

export interface RoundTrack {
  done: boolean;
  tokPerSec: number;
  /** Temps jusqu'au premier token, mesuré côté serveur (fenêtre de décode). */
  ttftMs?: number;
  error?: string;
}

export interface RoundStateData {
  state: RoundState;
  local: RoundTrack;
  cloud: RoundTrack;
}

const TERMINAL: RoundState[] = ['revealed', 'expired', 'failed'];

export function isTerminal(state: RoundState): boolean {
  return TERMINAL.includes(state);
}

export function transition(data: RoundStateData, event: RoundEvent): RoundStateData {
  if (isTerminal(data.state)) return data; // idempotent en terminal

  switch (event.type) {
    case 'START':
      if (data.state !== 'queued') return data;
      return { ...data, state: 'live' };

    case 'LOCAL_DONE':
      if (data.state !== 'live') return data;
      return maybeAwait({ ...data, local: { done: true, tokPerSec: event.tokPerSec, ttftMs: event.ttftMs } });

    case 'CLOUD_DONE':
      if (data.state !== 'live') return data;
      return maybeAwait({ ...data, cloud: { done: true, tokPerSec: event.tokPerSec, ttftMs: event.ttftMs } });

    case 'LANE_FAIL': {
      if (data.state !== 'live' && data.state !== 'awaiting_vote') return data;
      const failed = { ...data, [event.lane]: { ...data[event.lane], done: true, error: event.reason } } as RoundStateData;
      // Les deux couloirs morts → manche perdue ; sinon on attend que le
      // survivant finisse (pas de vote pendant qu'une piste diffuse encore).
      const bothDead = failed.local.error && failed.cloud.error;
      if (bothDead) return { ...failed, state: 'failed' };
      return maybeAwait(failed);
    }

    case 'VOTE':
      if (data.state !== 'awaiting_vote') return data;
      return { ...data, state: 'revealed' };

    case 'EXPIRE':
      return { ...data, state: 'expired' };

    case 'FAIL':
      return { ...data, state: 'failed' };
  }
}

function maybeAwait(data: RoundStateData): RoundStateData {
  if (data.local.done && data.cloud.done) return { ...data, state: 'awaiting_vote' };
  return data;
}

export function initialRoundState(): RoundStateData {
  return {
    state: 'queued',
    local: { done: false, tokPerSec: 0 },
    cloud: { done: false, tokPerSec: 0 },
  };
}
