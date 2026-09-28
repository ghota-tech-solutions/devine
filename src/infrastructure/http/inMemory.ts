import { RateLimitedError } from '@domain/entities/round';
import type { Leaderboard, Round } from '@domain/entities/round';
import type { RateLimiter, RoundRepository, StatsRepository } from '@application/ports/ports';
import { median } from '@domain/entities/round';

/** Implémentations en mémoire — utilisées par les tests et le mode local (`dev`). */

export class MemoryRoundRepository implements RoundRepository {
  private rounds = new Map<string, Round>();
  private daily = new Map<string, number>();
  private listeners = new Map<string, Set<(r: Round) => void>>();

  async create(round: Round) {
    this.rounds.set(round.id, round);
  }
  async get(id: string) {
    return this.rounds.get(id) ?? null;
  }
  async update(id: string, patch: Partial<Round>) {
    const cur = this.rounds.get(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.rounds.set(id, next);
    for (const cb of this.listeners.get(id) ?? []) cb(next);
  }
  async leaderboard(): Promise<Leaderboard> {
    const voted = [...this.rounds.values()].filter((r) => r.vote);
    const doneLocal = [...this.rounds.values()].filter((r) => r.machine.local.done).map((r) => r.machine.local.tokPerSec);
    const doneCloud = [...this.rounds.values()].filter((r) => r.machine.cloud.done).map((r) => r.machine.cloud.tokPerSec);
    return {
      rounds: this.rounds.size,
      correctVotes: voted.filter((r) => r.vote!.correct).length,
      medianLocalTokPerSec: median(doneLocal),
      medianCloudTokPerSec: median(doneCloud),
    };
  }
  async incrementDailyCounter(day: string) {
    const n = (this.daily.get(day) ?? 0) + 1;
    this.daily.set(day, n);
    return n;
  }
  subscribe(id: string, onChange: (r: Round) => void) {
    if (!this.listeners.has(id)) this.listeners.set(id, new Set());
    this.listeners.get(id)!.add(onChange);
    return () => this.listeners.get(id)?.delete(onChange);
  }
}

export class MemoryStatsRepository implements StatsRepository {
  private agg = { rounds: 0, correctVotes: 0, localSamples: [] as number[], cloudSamples: [] as number[] };

  async recordLaneDone(_day: string, lane: 'local' | 'cloud', tokPerSec: number) {
    if (lane === 'cloud') this.agg.rounds += 1;
    if (tokPerSec > 0) this.agg[lane === 'local' ? 'localSamples' : 'cloudSamples'].push(tokPerSec);
  }
  async recordVote(_day: string, correct: boolean) {
    if (correct) this.agg.correctVotes += 1;
  }
  async totals() {
    return { ...this.agg, localSamples: [...this.agg.localSamples], cloudSamples: [...this.agg.cloudSamples] };
  }
}

export class SlidingWindowRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private maxPerWindow: number, private windowMs: number) {}
  consume(key: string, nowMs: number) {
    const recent = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (recent.length >= this.maxPerWindow) {
      const retry = Math.ceil((this.windowMs - (nowMs - recent[0])) / 1000);
      throw new RateLimitedError(Math.max(1, retry));
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
  }
}

/**
 * Fausse passerelle streaming pour les tests : texte donné, débit simulé.
 * `paceMs` > 0 (prod locale sans Vertex) : émet token par token pour que la
 * démo ne trahisse pas son côté par une réponse instantanée. Jamais un
 * faux débit mesuré — tokPerSec reste celui annoncé, clairement démo.
 */
export function fakeStreamGateway(text: string, tokPerSec = 120, paceMs = 0, firstTokenDelayMs = 0) {
  return {
    async stream(_prompt: string, onChunk: (t: string) => void) {
      const tokens = text.split(/(?<=\s)/);
      if (firstTokenDelayMs) await new Promise((r) => setTimeout(r, firstTokenDelayMs));
      for (const t of tokens) {
        onChunk(t);
        if (paceMs) await new Promise((r) => setTimeout(r, paceMs));
      }
      return { tokPerSec, ttftMs: firstTokenDelayMs, fullText: text };
    },
  };
}

/** Horloge figée — pour les tests uniquement. */
export const fixedClock = (nowMs = Date.now()) => ({
  nowMs: () => nowMs,
  day: () => new Date(nowMs).toISOString().slice(0, 10),
});

/** Horloge réelle — le navigateur doit voir le texte progresser, pas
 *  l'écriture finale d'un coup. Une horloge figée casse le flush. */
export const systemClock = () => ({
  nowMs: () => Date.now(),
  day: () => new Date().toISOString().slice(0, 10),
});
