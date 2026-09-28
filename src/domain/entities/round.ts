import type { RoundStateData } from '@domain/states/roundStateMachine';

export const MAX_PROMPT_CHARS = 1500;

export class DomainError extends Error {}
export class PromptTooLongError extends DomainError {
  constructor() { super(`Prompt trop long (max ${MAX_PROMPT_CHARS} caractères)`); }
}
export class PromptEmptyError extends DomainError {
  constructor() { super('Prompt vide.'); }
}
export class RateLimitedError extends DomainError {
  constructor(retryAfterSec: number) { super(`Trop de manches, réessaie dans ${retryAfterSec} s.`); }
}
export class QuotaExhaustedError extends DomainError {
  constructor() { super('Contingent journalier de manches atteint.'); }
}
export class VoteNotAllowedError extends DomainError {
  constructor(state: string) { super(`Vote impossible tant que la manche est « ${state} ».`); }
}

export type Side = 'left' | 'right';

/** Tirage du côté où tourne le Mac — une manche sur deux, imprévisible. */
export function rollMacSide(rand: () => number = Math.random): Side {
  return rand() < 0.5 ? 'left' : 'right';
}

export interface Round {
  id: string;
  createdAtMs: number;
  prompt: string;
  /** Côté où tourne le Mac cette manche-là — jamais affiché avant la révélation. */
  macSide: Side;
  // Réponses partielles (textes reçus) — alimentés par les streams.
  localText: string;
  cloudText: string;
  /** Raisonnement du Mac, montré seulement après la révélation. */
  localReasoning?: string;
  machine: RoundStateData;
  vote?: { choice: 'left' | 'right' | 'tie'; correct: boolean };
}

export interface Leaderboard {
  rounds: number;
  correctVotes: number;
  medianLocalTokPerSec: number;
  medianCloudTokPerSec: number;
}

export function normalizePrompt(raw: string): string {
  const p = raw.trim();
  if (p.length === 0) throw new PromptEmptyError();
  if (p.length > MAX_PROMPT_CHARS) throw new PromptTooLongError();
  return p;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
