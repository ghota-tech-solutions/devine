import { VoteNotAllowedError } from '@domain/entities/round';
import { transition } from '@domain/states/roundStateMachine';
import type { Clock, RoundRepository, StatsRepository } from '@application/ports/ports';
import { median } from '@domain/entities/round';
import type { RoundStateData } from '@domain/states/roundStateMachine';

/** Vote : transition vers révélé, corrigé contre le côté tiré du Mac. */
export function makeCastVoteUseCase(deps: { rounds: RoundRepository; stats?: StatsRepository; clock: Clock }) {
  return async function castVote(input: { roundId: string; choice: 'left' | 'right' | 'tie' }) {
    const round = await deps.rounds.get(input.roundId);
    if (!round) throw new VoteNotAllowedError('introuvable');
    if (round.vote) return round; // premier vote gagne, idempotent
    // Pas de vote avant la fin des deux pistes : sinon on écrit un vote dans
    // une manche encore « live » et la révélation ne se déclenche jamais.
    if (round.machine.state !== 'awaiting_vote') throw new VoteNotAllowedError(round.machine.state);

    // Le Mac est à gauche OU à droite selon le tirage de la manche.
    const correct = input.choice !== 'tie' && input.choice === round.macSide;
    const machine = transition(round.machine, { type: 'VOTE', choice: input.choice, correct });
    const updated = { ...round, machine, vote: { choice: input.choice, correct } };
    await deps.rounds.update(input.roundId, updated);
    // Idem : les agrégats survivent au TTL des manches.
    await deps.stats?.recordVote(deps.clock.day(), correct).catch(() => {});
    return updated;
  };
}

export function makeGetLeaderboardUseCase(deps: { rounds: RoundRepository; stats?: StatsRepository }) {
  return async function getLeaderboard() {
    if (deps.stats) {
      const t = await deps.stats.totals();
      if (t.rounds > 0) {
        return {
          rounds: t.rounds,
          correctVotes: t.correctVotes,
          medianLocalTokPerSec: median(t.localSamples),
          medianCloudTokPerSec: median(t.cloudSamples),
        };
      }
    }
    return deps.rounds.leaderboard();
  };
}

export type { RoundStateData };
