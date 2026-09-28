import type { Round, Side } from '@domain/entities/round';
import type { RoundState, RoundTrack } from '@domain/states/roundStateMachine';

// Vue d'une manche envoyée au navigateur. Le code est public et l'onglet
// Réseau aussi : avant la révélation, rien ne doit dire quelle piste est le
// Mac — ni `macSide`, ni des clés `local`/`cloud`, ni un message d'erreur
// propre à un fournisseur, ni les mesures (débit, 1er mot) qui le trahiraient
// d'un coup d'œil. Les pistes sont donc rangées par POSITION.

export interface PublicLane {
  text: string;
  done: boolean;
  /** Mesures : seulement après la révélation. */
  tokPerSec?: number;
  ttftMs?: number;
  failed: boolean;
  /** Détail de la panne, seulement après la révélation. */
  error?: string;
  /** Raisonnement du modèle, seulement après la révélation. */
  reasoning?: string;
}

export interface PublicRound {
  state: RoundState;
  lanes: Record<Side, PublicLane>;
  /** Présents seulement une fois la manche révélée. */
  macSide?: Side;
  vote?: Round['vote'];
}

function lane(text: string, track: RoundTrack, revealed: boolean, reasoning?: string): PublicLane {
  return {
    text,
    done: track.done,
    failed: !!track.error,
    ...(revealed ? { tokPerSec: track.tokPerSec, ttftMs: track.ttftMs } : {}),
    ...(revealed && track.error ? { error: track.error } : {}),
    ...(revealed && reasoning ? { reasoning } : {}),
  };
}

export function toPublicRound(r: Round): PublicRound {
  const revealed = r.machine.state === 'revealed';
  const mac = lane(r.localText, r.machine.local, revealed, r.localReasoning);
  const cloud = lane(r.cloudText, r.machine.cloud, revealed);
  const lanes = r.macSide === 'left' ? { left: mac, right: cloud } : { left: cloud, right: mac };
  return {
    state: r.machine.state,
    lanes,
    ...(revealed ? { macSide: r.macSide, vote: r.vote } : {}),
  };
}
