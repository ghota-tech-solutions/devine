import type { MacStats, SystemMonitor } from '@application/ports/ports';

export interface GetMacStatsDeps {
  monitor: SystemMonitor;
  /** Vrai seulement quand le serveur tourne sur le Mac (mode direct). */
  enabled: boolean;
}

/** Instantané télémétrique du Mac. Hors Mac (Cloud Run), available:false —
 *  Jamais de chiffres inventés. */
export function makeGetMacStatsUseCase(deps: GetMacStatsDeps) {
  return async function getMacStats(): Promise<MacStats> {
    if (!deps.enabled) {
      return { available: false, cpuLoadPct: 0, memUsedGb: 0, memTotalGb: 0, wiredGb: 0, omlxRssGb: 0, uptimeSec: 0 };
    }
    return deps.monitor.snapshot();
  };
}
