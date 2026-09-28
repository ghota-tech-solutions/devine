import { describe, expect, test } from 'bun:test';
import { makeStartRoundUseCase } from '@application/usecases/playRound';
import { makeCastVoteUseCase, makeGetLeaderboardUseCase } from '@application/usecases/voteAndLeaderboard';
import { fakeStreamGateway, fixedClock, MemoryRoundRepository, MemoryStatsRepository, SlidingWindowRateLimiter } from '@infrastructure/http/inMemory';
import { MAX_PROMPT_CHARS, PromptEmptyError, PromptTooLongError, QuotaExhaustedError, RateLimitedError } from '@domain/entities/round';
import type { TextStreamGateway } from '@application/ports/ports';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Piste Mac qu'on termine à la main : la manche reste « live » d'ici là. */
function heldGateway() {
  let release!: () => void;
  const done = new Promise<void>((r) => { release = r; });
  const gateway: TextStreamGateway = {
    async stream(_prompt, onChunk) {
      onChunk('Mac local.');
      await done;
      return { tokPerSec: 90, ttftMs: 100, fullText: 'Mac local.' };
    },
  };
  return { gateway, release };
}

function makeWorld(opts: { maxPerDay?: number; rounds?: MemoryRoundRepository; local?: TextStreamGateway } = {}) {
  const rounds = opts.rounds ?? new MemoryRoundRepository();
  const clock = fixedClock(1_700_000_000_000);
  const app = makeStartRoundUseCase({
    clock,
    rateLimiter: new SlidingWindowRateLimiter(2, 60_000),
    rounds,
    cloud: fakeStreamGateway('Bonjour je suis le nuage.', 150),
    local: opts.local ?? fakeStreamGateway('Mac local.', 90),
    maxRoundsPerDay: opts.maxPerDay ?? 100,
    flushIntervalMs: 0,
  });
  return { rounds, app };
}

describe('PlayRound', () => {
  test('un prompt valide crée une manche qui démarre tout de suite quand la file est vide', async () => {
    // GIVEN une file vide et une piste Mac encore en train d'écrire
    const held = heldGateway();
    const { rounds, app } = makeWorld({ local: held.gateway });
    // WHEN on lance une manche
    const result = await app({ prompt: 'Raconte une blague.', ip: '1.2.3.4' });
    await sleep(5);
    // THEN elle part tout de suite et court
    expect(result.queuePosition).toBe(0);
    const round = await rounds.get(result.roundId);
    expect(round?.prompt).toBe('Raconte une blague.');
    expect(round?.machine.state).toBe('live');
    held.release();
  });

  test('une deuxième question attend dans la file que la première ait fini', async () => {
    // GIVEN une manche en cours dont la piste Mac n'a pas fini
    const held = heldGateway();
    const { rounds, app } = makeWorld({ local: held.gateway });
    await app({ prompt: 'première', ip: '1.1.1.1' });
    // WHEN une deuxième question arrive
    const second = await app({ prompt: 'deuxième', ip: '2.2.2.2' });
    await sleep(20);
    // THEN elle est 1ʳᵉ en attente, sans stream
    expect(second.queuePosition).toBe(1);
    expect((await rounds.get(second.roundId))?.machine.state).toBe('queued');
    expect((await rounds.get(second.roundId))?.cloudText).toBe('');
    // WHEN la piste Mac de la première se termine
    held.release();
    await sleep(40);
    // THEN la deuxième a démarré
    expect((await rounds.get(second.roundId))?.machine.state).not.toBe('queued');
  });

  test('sans oMLX, la piste Mac échoue et le nuage répond seul', async () => {
    // GIVEN un Mac hors ligne
    const offline: TextStreamGateway = { async stream() { throw new Error('Mac hors ligne'); } };
    const { rounds, app } = makeWorld({ local: offline });
    // WHEN on lance une manche
    const { roundId } = await app({ prompt: 'Bonjour', ip: '1.2.3.4' });
    await sleep(50);
    // THEN le vote s'ouvre quand même, la piste Mac marquée en panne
    const round = await rounds.get(roundId);
    expect(round?.machine.local.error).toContain('Mac hors ligne');
    expect(round?.machine.state).toBe('awaiting_vote');
  });

  test('le prompt vide est refusé', async () => {
    // GIVEN un monde prêt
    const { app } = makeWorld();
    // WHEN un prompt vide arrive
    // THEN refus
    await expect(app({ prompt: '   ', ip: '1.2.3.4' })).rejects.toBeInstanceOf(PromptEmptyError);
  });

  test('le prompt trop long est refusé', async () => {
    // GIVEN un monde prêt
    const { app } = makeWorld();
    // WHEN un prompt de 1 501 caractères
    // THEN refus
    await expect(app({ prompt: 'a'.repeat(MAX_PROMPT_CHARS + 1), ip: '1.2.3.4' })).rejects.toBeInstanceOf(PromptTooLongError);
  });

  test('le quota journalier coupe les manches au-delà du plafond', async () => {
    // GIVEN un plafond de 1 manche par jour
    const { app } = makeWorld({ maxPerDay: 1 });
    // WHEN une deuxième manche
    await app({ prompt: 'première', ip: '1.1.1.1' });
    // THEN la deuxième est refusée par le contingent (pas par l'IP)
    await expect(app({ prompt: 'deuxième', ip: '2.2.2.2' })).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  test('l’anti-abus par IP frappe avant le quota global', async () => {
    // GIVEN une fenêtre de 2 manches par IP
    const { app } = makeWorld();
    // WHEN une troisième manche depuis la même IP
    await app({ prompt: 'une', ip: '9.9.9.9' });
    await app({ prompt: 'deux', ip: '9.9.9.9' });
    // THEN refus 429
    await expect(app({ prompt: 'trois', ip: '9.9.9.9' })).rejects.toBeInstanceOf(RateLimitedError);
  });

  test('le stream cloud remplit la manche puis passe CLOUD_DONE', async () => {
    // GIVEN un monde prêt
    const { rounds, app } = makeWorld();
    // WHEN on lance une manche, puis qu'on laisse le stream se terminer
    const { roundId } = await app({ prompt: 'Bonjour', ip: '1.2.3.4' });
    await sleep(50);
    // THEN le texte cloud est là et l'état marqué terminé côté cloud
    const round = await rounds.get(roundId);
    expect(round?.cloudText).toContain('nuage');
    expect(round?.machine.cloud.done).toBe(true);
  });
});

describe('CastVote et classement', () => {
  test('le vote est corrigé contre le côté tiré du Mac, pas contre la gauche', async () => {
    // GIVEN une manche terminée — on lit le côté qui a été tiré
    const { rounds, app } = makeWorld();
    const { roundId, macSide } = await app({ prompt: 'Bonjour', ip: '1.2.3.4' });
    await sleep(5); // la manche quitte la file avant qu'on force son état
    await rounds.update(roundId, {
      machine: { state: 'awaiting_vote', local: { done: true, tokPerSec: 90 }, cloud: { done: true, tokPerSec: 150 } },
    });
    // WHEN on désigne le côté du Mac
    const updated = await makeCastVoteUseCase({ rounds, clock: fixedClock() })({ roundId, choice: macSide });
    // THEN bon vote, révélé
    expect(updated.vote?.correct).toBe(true);
    expect(updated.machine.state).toBe('revealed');
  });

  test('désigner le mauvais côté donne un faux vote', async () => {
    // GIVEN une manche terminée
    const { rounds, app } = makeWorld();
    const { roundId, macSide } = await app({ prompt: 'Bonjour', ip: '1.2.3.4' });
    await sleep(5); // la manche quitte la file avant qu'on force son état
    await rounds.update(roundId, {
      machine: { state: 'awaiting_vote', local: { done: true, tokPerSec: 90 }, cloud: { done: true, tokPerSec: 150 } },
    });
    // WHEN on vote le côté opposé au Mac
    const wrong = macSide === 'left' ? 'right' : 'left';
    const updated = await makeCastVoteUseCase({ rounds, clock: fixedClock() })({ roundId, choice: wrong });
    // THEN mauvais vote
    expect(updated.vote?.correct).toBe(false);
  });

  test('le côté du Mac est tiré des deux côtés sur plusieurs manches', async () => {
    // GIVEN 30 manches lancées
    const { app } = makeWorld({ maxPerDay: 100 });
    const sides = new Set<string>();
    // WHEN on lance (IP distinctes pour ne pas se faire couper par l'anti-abus)
    for (let i = 0; i < 30; i++) {
      const { macSide } = await app({ prompt: `manche ${i}`, ip: `7.7.${i}.1` });
      sides.add(macSide);
    }
    // THEN les deux côtés sont sortis au moins une fois (probabilité de raté < 10⁻⁹)
    expect(sides.size).toBe(2);
  });

  test('un second vote ne remplace pas le premier', async () => {
    // GIVEN une manche déjà votée à gauche
    const { rounds, app } = makeWorld();
    const { roundId } = await app({ prompt: 'Bonjour', ip: '1.2.3.4' });
    await sleep(5); // la manche quitte la file avant qu'on force son état
    await rounds.update(roundId, {
      machine: { state: 'awaiting_vote', local: { done: true, tokPerSec: 90 }, cloud: { done: true, tokPerSec: 150 } },
    });
    await makeCastVoteUseCase({ rounds, clock: fixedClock() })({ roundId, choice: 'left' });
    // WHEN un autre visiteur vote droite
    const updated = await makeCastVoteUseCase({ rounds, clock: fixedClock() })({ roundId, choice: 'right' });
    // THEN le premier vote reste
    expect(updated.vote?.choice).toBe('left');
  });

  test('le classement agrège votes et médianes de débit', async () => {
    // GIVEN une manche votée aux deux flux terminés
    const { rounds, app } = makeWorld();
    const { roundId } = await app({ prompt: 'Bonjour', ip: '1.2.3.4' });
    await sleep(5); // la manche quitte la file avant qu'on force son état
    await rounds.update(roundId, {
      machine: { state: 'awaiting_vote', local: { done: true, tokPerSec: 90 }, cloud: { done: true, tokPerSec: 150 } },
    });
    const macSide = (await rounds.get(roundId))!.macSide;
    await makeCastVoteUseCase({ rounds, clock: fixedClock() })({ roundId, choice: macSide === 'left' ? 'right' : 'left' });
    // WHEN on lit le classement
    const board = await rounds.leaderboard();
    // THEN 1 manche, 0 bon vote (côté opposé au Mac), médianes conservées
    expect(board.rounds).toBe(1);
    expect(board.correctVotes).toBe(0);
    expect(board.medianLocalTokPerSec).toBe(90);
    expect(board.medianCloudTokPerSec).toBe(150);
  });
});

describe('PlayRound, les deux pistes', () => {
  test('les deux passerelles remplissent leurs couloirs et le vote s’ouvre', async () => {
    // GIVEN un nuage et un oMLX simulés
    const { rounds, app } = makeWorld();
    // WHEN on lance une manche
    const { roundId } = await app({ prompt: 'Bonjour', ip: '1.2.3.4' });
    await sleep(50);
    // THEN les deux textes sont là et le vote est ouvert
    const round = await rounds.get(roundId);
    expect(round?.machine.local.error).toBeUndefined();
    expect(round?.localText).toContain('Mac local');
    expect(round?.cloudText).toContain('nuage');
    expect(round?.machine.state).toBe('awaiting_vote');
  });
});

describe('stats durables', () => {
  test('le classement survit à la purge des manches', async () => {
    // GIVEN des agrégats enregistrés, et des manches purgées (TTL)
    const stats = new MemoryStatsRepository();
    await stats.recordLaneDone('2026-09-28', 'cloud', 200);
    await stats.recordLaneDone('2026-09-28', 'local', 100);
    await stats.recordVote('2026-09-28', true);
    // WHEN on lit le classement sans aucune manche en base
    const lb = await makeGetLeaderboardUseCase({ rounds: new MemoryRoundRepository(), stats })();
    // THEN les stats ont survécu
    expect(lb.rounds).toBe(1);
    expect(lb.correctVotes).toBe(1);
    expect(lb.medianCloudTokPerSec).toBe(200);
    expect(lb.medianLocalTokPerSec).toBe(100);
  });

  test('classement sans agrégats : repli sur les manches encore vivantes', async () => {
    // GIVEN une manche jouée, jamais comptée dans les stats
    const { rounds, app } = makeWorld();
    await app({ prompt: 'Tapez.', ip: '8.8.8.8' });
    await new Promise((r) => setTimeout(r, 60));
    // WHEN — stats vierges, la manche est encore en base
    const lb = await makeGetLeaderboardUseCase({ rounds, stats: new MemoryStatsRepository() })();
    // THEN le repli répond (1 manche au compteur), pas un écran vide
    expect(lb.rounds).toBeGreaterThanOrEqual(1);
  });
});
