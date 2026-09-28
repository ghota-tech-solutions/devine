import { describe, expect, test } from 'bun:test';
import { toPublicRound } from '@application/usecases/publicRound';
import type { Round } from '@domain/entities/round';

function round(state: Round['machine']['state'], macSide: 'left' | 'right'): Round {
  return {
    id: 'r1',
    createdAtMs: 0,
    prompt: 'Bonjour',
    macSide,
    localText: 'texte du Mac',
    cloudText: 'texte du nuage',
    localReasoning: 'je réfléchis en secret',
    machine: {
      state,
      local: { done: true, tokPerSec: 90, ttftMs: 300 },
      cloud: { done: true, tokPerSec: 150, ttftMs: 700, error: 'Vertex 503' },
    },
    ...(state === 'revealed' ? { vote: { choice: macSide, correct: true } } : {}),
  };
}

describe('Vue publique d’une manche', () => {
  test('avant la révélation, rien ne dit quelle piste est le Mac, pas même les mesures', () => {
    // GIVEN une manche en attente de vote, Mac à droite
    const r = round('awaiting_vote', 'right');
    // WHEN on la sérialise pour le navigateur
    const json = JSON.stringify(toPublicRound(r));
    // THEN ni côté, ni clés local/cloud, ni message d'erreur du fournisseur
    expect(json).not.toContain('macSide');
    expect(json).not.toMatch(/"(local|cloud|localText|cloudText|machine)"/);
    expect(json).not.toContain('Vertex');
    expect(json).not.toMatch(/tokPerSec|ttftMs/);
    expect(json).not.toContain('secret');
    // … mais les pistes sont bien rangées par position
    expect(toPublicRound(r).lanes.right.text).toBe('texte du Mac');
    expect(toPublicRound(r).lanes.left.failed).toBe(true);
  });

  test('après la révélation, le côté et le détail des pannes sont donnés', () => {
    // GIVEN une manche révélée, Mac à gauche
    const r = round('revealed', 'left');
    // WHEN on la sérialise
    const pub = toPublicRound(r);
    // THEN le côté, les mesures et l'erreur apparaissent
    expect(pub.macSide).toBe('left');
    expect(pub.lanes.left.tokPerSec).toBe(90);
    expect(pub.lanes.right.ttftMs).toBe(700);
    expect(pub.lanes.left.reasoning).toBe('je réfléchis en secret');
    expect(pub.lanes.left.text).toBe('texte du Mac');
    expect(pub.lanes.right.error).toBe('Vertex 503');
  });
});
