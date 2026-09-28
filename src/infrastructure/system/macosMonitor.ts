import { execSync } from 'node:child_process';
import { totalmem, freemem, loadavg, cpus, uptime, platform } from 'node:os';
import type { MacStats, SystemMonitor } from '@application/ports/ports';

/**
 * Télémétrie macOS sans sudo : CPU (charge 1 min / cœurs), RAM utilisée,
 * mémoire « wired » (là où residency les poids du modèle sur le GPU), uptime.
 * L'utilisation GPU en % n'est pas accessible sans sudo (powermetrics) :
 * on montre la wired memory, qui suit la charge du modèle — pas un faux chiffre.
 */
export function makeMacosMonitor(): SystemMonitor {
  return {
    async snapshot(): Promise<MacStats> {
      if (platform() !== 'darwin') {
        return { available: false, cpuLoadPct: 0, memUsedGb: 0, memTotalGb: 0, wiredGb: 0, omlxRssGb: 0, uptimeSec: 0 };
      }
      const total = totalmem();
      const used = total - freemem();
      return {
        available: true,
        cpuLoadPct: Math.min(100, Math.round((loadavg()[0] / cpus().length) * 100)),
        memUsedGb: round1(used / 2 ** 30),
        memTotalGb: round1(total / 2 ** 30),
        wiredGb: round1(wiredBytes() / 2 ** 30),
        omlxRssGb: round1(omlxDaemonRssGb()),
        uptimeSec: Math.round(uptime()),
      };
    },
  };
}

/** RAM occupée par le démon oMLX — la vraie taille des poids résidents. */
function omlxDaemonRssGb(): number {
  try {
    const pids = execSync("pgrep -if omlx", { timeout: 1500 }).toString().trim().split('\n').filter(Boolean);
    if (!pids.length) return 0;
    const out = execSync(`ps -o rss= -p ${pids.join(',')}`, { timeout: 1500 }).toString();
    return out.split('\n').reduce((sum, l) => sum + Number(l.trim() || 0), 0) / 2 ** 20;
  } catch {
    return 0;
  }
}

/** Pages « wired down » via vm_stat — page size lu dans l'en-tête, pas supposé. */
function wiredBytes(): number {
  try {
    const out = execSync('vm_stat', { timeout: 1500 }).toString();
    const pageSize = Number(out.match(/page size of (\d+)/)?.[1] ?? 16384);
    const wired = Number(out.match(/Pages wired down:\s+(\d+)/)?.[1] ?? 0);
    return wired * pageSize;
  } catch {
    return 0;
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
