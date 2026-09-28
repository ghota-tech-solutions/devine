import { describe, expect, test } from 'bun:test';
import {
  initialRoundState,
  isTerminal,
  transition,
  type RoundEvent,
  type RoundStateData,
} from '@domain/states/roundStateMachine';

const done = (l: number, c: number): RoundStateData => ({
  state: 'live',
  local: { done: l > 0, tokPerSec: l },
  cloud: { done: c > 0, tokPerSec: c },
});

describe('machine à états de la manche', () => {
  test('START fait passer queued à live', () => {
    // GIVEN une manche en file
    const queued = initialRoundState();
    // WHEN on démarre
    const next = transition(queued, { type: 'START' });
    // THEN elle est en course
    expect(next.state).toBe('live');
  });

  test('un seul flux terminé ne suffit pas pour le vote', () => {
    // GIVEN une course en cours
    // WHEN le cloud termine seul
    const next = transition(done(0, 0), { type: 'CLOUD_DONE', tokPerSec: 150 });
    // THEN on attend encore le local
    expect(next.state).toBe('live');
    expect(next.cloud.done).toBe(true);
    expect(next.local.done).toBe(false);
  });

  test('les deux flux terminés ouvrent le vote', () => {
    // GIVEN le cloud a déjà fini
    // WHEN le local finit à son tour
    const next = transition(done(0, 150), { type: 'LOCAL_DONE', tokPerSec: 90 });
    // THEN le vote est ouvert et les débits sont gardés
    expect(next.state).toBe('awaiting_vote');
    expect(next.local.tokPerSec).toBe(90);
    expect(next.cloud.tokPerSec).toBe(150);
  });

  test('un vote en attente révèle la manche', () => {
    // GIVEN une manche prête à voter
    const awaiting = transition(done(90, 150), { type: 'LOCAL_DONE', tokPerSec: 90 });
    // WHEN le visiteur vote
    const next = transition(awaiting, { type: 'VOTE', choice: 'left', correct: true });
    // THEN révélée
    expect(next.state).toBe('revealed');
  });

  test('un vote hors délai de vote est ignoré', () => {
    // GIVEN une course qui n'a pas fini
    // WHEN un vote arrive trop tôt
    const next = transition(done(0, 0), { type: 'VOTE', choice: 'right', correct: false });
    // THEN rien ne bouge
    expect(next.state).toBe('live');
  });

  const table: Array<[RoundStateData['state'], RoundStateData, RoundEvent]> = [
    ['queued', initialRoundState(), { type: 'LOCAL_DONE', tokPerSec: 1 }],
    ['queued', initialRoundState(), { type: 'VOTE', choice: 'left', correct: true }],
    ['revealed', { ...done(90, 150), state: 'revealed' }, { type: 'EXPIRE' }],
    ['failed', { ...done(0, 0), state: 'failed' }, { type: 'START' }],
  ];

  test('aucun événement ne fait sortir d’un état terminal ni avancer un état non prêt', () => {
    for (const [expectedState, data, event] of table) {
      // GIVEN un état (non) prêt et un événement malvenu
      // WHEN on le dispatche
      const next = transition(data, event);
      // THEN l'état ne change pas (table : queued, revealed, failed)
      if (expectedState !== 'queued') expect(next.state).toBe(expectedState);
      else expect(next.state).toBe('queued');
    }
  });

  test('EXPIRE éteint tout état non terminal', () => {
    for (const data of [initialRoundState(), done(0, 0), { ...done(90, 150), state: 'awaiting_vote' as const }]) {
      // GIVEN un état vivant
      // WHEN expire
      // THEN expired, terminal
      expect(transition(data, { type: 'EXPIRE' }).state).toBe('expired');
      expect(isTerminal('expired')).toBe(true);
    }
  });
});

describe('couloir en échec isolé', () => {
  test('un couloir mort n’empêche pas le vote si l’autre a répondu', () => {
    // GIVEN le cloud a fini, le local est en cours
    const cloudDone = transition(done(0, 150), { type: 'CLOUD_DONE', tokPerSec: 150 });
    // WHEN le local meurt
    const next = transition(cloudDone, { type: 'LANE_FAIL', lane: 'local', reason: 'oMLX 507' });
    // THEN on peut voter, et seule la piste locale porte l'erreur
    expect(next.state).toBe('awaiting_vote');
    expect(next.local.error).toBe('oMLX 507');
    expect(next.cloud.error).toBeUndefined();
  });

  test('un couloir mort pendant que l’autre diffuse garde la manche live', () => {
    // GIVEN les deux pistes en cours
    const live = transition(done(0, 0), { type: 'START' });
    // WHEN le local meurt, le cloud n'a pas fini
    const halfDead = transition(live, { type: 'LANE_FAIL', lane: 'local', reason: 'Mac hors ligne' });
    // THEN pas de vote pendant que le cloud diffuse encore
    expect(halfDead.state).toBe('live');
    expect(halfDead.local.error).toBe('Mac hors ligne');
    // WHEN le cloud finit
    const next = transition(halfDead, { type: 'CLOUD_DONE', tokPerSec: 210 });
    // THEN le vote se débloque enfin
    expect(next.state).toBe('awaiting_vote');
  });

  test('les deux couloirs morts tuent la manche', () => {
    // GIVEN un couloir déjà mort
    const oneDead = transition(done(0, 0), { type: 'LANE_FAIL', lane: 'cloud', reason: '403' });
    // WHEN l'autre meurt aussi
    const next = transition(oneDead, { type: 'LANE_FAIL', lane: 'local', reason: '507' });
    // THEN manche perdue
    expect(next.state).toBe('failed');
  });
});
