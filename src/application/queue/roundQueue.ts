// File d'attente des manches — le Mac ne sert qu'une manche à la fois (sinon
// les deux pistes se partagent le GPU et la mesure ne veut plus rien dire).
// Le visiteur pose sa question tout de suite ; elle part quand vient son tour.
//
// File en mémoire du processus : elle n'est globale que sur UNE instance
// (Cloud Run max_instance_count = 1, voir terraform/cloud_run.tf).

export interface QueueStatus {
  /** 0 = en cours, n ≥ 1 = n-ième en attente, null = inconnue (finie ou ailleurs). */
  position: number | null;
  running: number;
  waiting: number;
}

type Job = { id: string; run: () => Promise<void>; owner?: string };

export class RoundQueue {
  private waitingJobs: Job[] = [];
  private runningIds = new Set<string>();
  /** Visiteurs (clé IP) qui ont déjà une manche en file ou en cours. */
  private owners = new Map<string, string>();

  constructor(private readonly concurrency = 1) {}

  /** Ajoute une manche ; renvoie sa position (0 = démarre tout de suite). */
  enqueue(id: string, run: () => Promise<void>, owner?: string): number {
    if (owner) this.owners.set(owner, id);
    this.waitingJobs.push({ id, run, owner });
    this.pump();
    return this.status(id).position ?? 0;
  }

  /** Vrai si ce visiteur a déjà une manche en file ou en cours. */
  hasActive(owner: string): boolean {
    return this.owners.has(owner);
  }

  status(id?: string): QueueStatus {
    let position: number | null = null;
    if (id && this.runningIds.has(id)) position = 0;
    else if (id) {
      const i = this.waitingJobs.findIndex((j) => j.id === id);
      if (i >= 0) position = i + 1;
    }
    return { position, running: this.runningIds.size, waiting: this.waitingJobs.length };
  }

  private pump() {
    while (this.runningIds.size < this.concurrency && this.waitingJobs.length > 0) {
      const job = this.waitingJobs.shift()!;
      this.runningIds.add(job.id);
      job.run()
        .catch(() => { /* une manche en échec ne bloque jamais la file */ })
        .finally(() => {
          this.runningIds.delete(job.id);
          if (job.owner && this.owners.get(job.owner) === job.id) this.owners.delete(job.owner);
          this.pump();
        });
    }
  }
}
