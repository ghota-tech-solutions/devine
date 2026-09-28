import { describe, expect, test } from 'bun:test';
import { RoundQueue } from '@application/queue/roundQueue';
import { clientIp } from '@infrastructure/http/clientIp';

describe('IP du visiteur', () => {
  test('seule la dernière entrée de X-Forwarded-For compte (ajoutée par le frontal Cloud Run)', () => {
    // GIVEN un visiteur qui forge X-Forwarded-For
    const h = new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' });
    // WHEN on lit son IP
    // THEN l'IP ajoutée par le frontal gagne, la valeur forgée est ignorée
    expect(clientIp(h)).toBe('203.0.113.9');
  });

  test('sans en-tête, une clé commune plutôt qu’une exception', () => {
    // GIVEN une requête locale sans X-Forwarded-For
    // WHEN on lit son IP
    // THEN repli sur « inconnue »
    expect(clientIp(new Headers())).toBe('inconnue');
  });
});

describe('File des manches', () => {
  test('une place à la fois, les suivantes gardent leur rang', async () => {
    // GIVEN une file à une place et trois manches
    const q = new RoundQueue(1);
    let release!: () => void;
    const first = new Promise<void>((r) => { release = r; });
    // WHEN on les ajoute
    expect(q.enqueue('a', () => first)).toBe(0);
    expect(q.enqueue('b', async () => {})).toBe(1);
    expect(q.enqueue('c', async () => {})).toBe(2);
    // THEN a court, b et c attendent dans l'ordre
    expect(q.status('b')).toEqual({ position: 1, running: 1, waiting: 2 });
    // WHEN a se termine
    release();
    await new Promise((r) => setTimeout(r, 5));
    // THEN la file s'est vidée
    expect(q.status()).toEqual({ position: null, running: 0, waiting: 0 });
  });

  test('une manche qui plante libère quand même sa place', async () => {
    // GIVEN une première manche en échec
    const q = new RoundQueue(1);
    q.enqueue('a', async () => { throw new Error('boum'); });
    let ran = false;
    // WHEN une seconde attend
    q.enqueue('b', async () => { ran = true; });
    await new Promise((r) => setTimeout(r, 5));
    // THEN elle a tourné
    expect(ran).toBe(true);
  });
});
