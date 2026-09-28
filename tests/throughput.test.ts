import { describe, expect, test } from 'bun:test';
import { estimateTokens, measureThroughput } from '@domain/entities/throughput';

describe('mesure de débit honnête (fenêtre de décode)', () => {
  test('le ratio exclut la file d’attente et le prefill', () => {
    // GIVEN une requête mise 10 s en file/prefill, puis 2 s de décode à 50 tok/s
    // WHEN on mesure
    const t = measureThroughput({
      startedAtMs: 0,
      firstTokenAtMs: 10_000,
      lastTokenAtMs: 12_000,
      completionTokens: 100,
      fullText: 'x'.repeat(400),
    });
    // THEN le débit est celui du décode, pas celui du tout-venant
    expect(t.tokPerSec).toBe(50);
    expect(t.ttftMs).toBe(10_000);
    expect(t.tokens).toBe(100);
  });

  test('sans usage fourni, on tombe sur l’estimation ~4 car./token', () => {
    // GIVEN un fournisseur muet sur les compteurs de tokens
    // WHEN on mesure 1 s de décode sur 400 caractères
    const t = measureThroughput({ startedAtMs: 0, firstTokenAtMs: 0, lastTokenAtMs: 1000, fullText: 'x'.repeat(400) });
    // THEN 100 tokens ≈ 100 tok/s, pas des mots
    expect(t.tokens).toBe(estimateTokens('x'.repeat(400)));
    expect(t.tokPerSec).toBe(100);
  });

  test('un décode trop court pour être significatif n’affiche pas de chiffre', () => {
    // GIVEN un token unique reçu en 50 ms
    // WHEN on mesure
    const t = measureThroughput({ startedAtMs: 0, firstTokenAtMs: 500, lastTokenAtMs: 550, completionTokens: 5, fullText: 'salut' });
    // THEN 0 = « pas de mesure », affiché « — » côté interface
    expect(t.tokPerSec).toBe(0);
  });

  test('aucun token reçu ne donne ni débit ni TTFT', () => {
    // GIVEN une manche morte
    const t = measureThroughput({ startedAtMs: 1000, firstTokenAtMs: null, lastTokenAtMs: null, fullText: '' });
    expect(t.tokPerSec).toBe(0);
    expect(t.ttftMs).toBeNull();
  });
});
