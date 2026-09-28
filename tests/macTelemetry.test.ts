import { describe, expect, test } from 'bun:test';
import { makeGetMacStatsUseCase } from '@application/usecases/macTelemetry';
import type { MacStats, SystemMonitor } from '@application/ports/ports';

const fakeMonitor = (s: MacStats): SystemMonitor => ({ snapshot: async () => s });

describe('télémétrie Mac', () => {
  test('hors Mac, la télémétrie est indisponible — jamais de chiffres inventés', async () => {
    // GIVEN un serveur activé mais déployé ailleurs (monitor dit non)
    const getStats = makeGetMacStatsUseCase({ monitor: fakeMonitor({ available: false, cpuLoadPct: 0, memUsedGb: 0, memTotalGb: 0, wiredGb: 0, omlxRssGb: 0, uptimeSec: 0 }), enabled: false });
    // WHEN on demande l’instantané
    const s = await getStats();
    // THEN rien n’est disponible
    expect(s.available).toBe(false);
  });

  test('sur le Mac, l’instantané du monitor passe tel quel', async () => {
    // GIVEN un monitor macOS qui renvoie de vraies mesures
    const real: MacStats = { available: true, cpuLoadPct: 42, memUsedGb: 96.3, memTotalGb: 128, wiredGb: 85.1, omlxRssGb: 43.9, uptimeSec: 3600 };
    const getStats = makeGetMacStatsUseCase({ monitor: fakeMonitor(real), enabled: true });
    // WHEN
    const s = await getStats();
    // THEN les valeurs sont transmises sans retouche
    expect(s).toEqual(real);
  });
});
