import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Leaderboard, Round } from '@domain/entities/round';
import type { RoundRepository, StatsRepository } from '@application/ports/ports';
import { median } from '@domain/entities/round';

function db() {
  if (getApps().length === 0) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT });
  }
  return getFirestore();
}

export class FirestoreRoundRepository implements RoundRepository {
  private col = () => db().collection('rounds');

  async create(round: Round) {
    await this.col().doc(round.id).set({ ...round, createdAt: FieldValue.serverTimestamp() });
  }
  async get(id: string): Promise<Round | null> {
    const snap = await this.col().doc(id).get();
    return snap.exists ? (snap.data() as Round) : null;
  }
  async update(id: string, patch: Partial<Round>) {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await this.col().doc(id).update(clean);
  }
  async leaderboard(): Promise<Leaderboard> {
    const snap = await this.col().limit(1000).get();
    const rounds = snap.docs.map((d) => d.data() as Round);
    const voted = rounds.filter((r) => r.vote);
    return {
      rounds: rounds.length,
      correctVotes: voted.filter((r) => r.vote!.correct).length,
      medianLocalTokPerSec: median(rounds.filter((r) => r.machine.local.done).map((r) => r.machine.local.tokPerSec)),
      medianCloudTokPerSec: median(rounds.filter((r) => r.machine.cloud.done).map((r) => r.machine.cloud.tokPerSec)),
    };
  }
  async incrementDailyCounter(day: string): Promise<number> {
    const ref = db().doc(`counters/${day}`);
    return db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const n = (snap.data()?.count as number) ?? 0;
      tx.set(ref, { count: n + 1 });
      return n + 1;
    });
  }
  subscribe(id: string, onChange: (r: Round) => void) {
    return this.col().doc(id).onSnapshot((snap) => {
      if (snap.exists) onChange(snap.data() as Round);
    });
  }
}

/**
 * Agrégats durables dans stats/summary : un seul document, mis à jour en
 * transaction. Les manches (collection rounds) ont un TTL de 30 jours — le
 * classement doit leur survivre, d'où ce compteur séparé sans expiration.
 */
export class FirestoreStatsRepository implements StatsRepository {
  private ref = () => db().doc('stats/summary');
  private static readonly SAMPLE_CAP = 1000;

  async recordLaneDone(day: string, lane: 'local' | 'cloud', tokPerSec: number) {
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(this.ref());
      const cur = snap.data() ?? { rounds: 0, correctVotes: 0, localSamples: [], cloudSamples: [] };
      const key = lane === 'local' ? 'localSamples' : 'cloudSamples';
      const samples = [...((cur[key] as number[]) ?? [])];
      // On ne compte que les vrais chiffres : une piste à 0 tok/s (estimation
      // trop courte) ne doit pas tirer la médiane vers le bas.
      if (tokPerSec > 0) samples.push(tokPerSec);
      const trimmed = samples.slice(-FirestoreStatsRepository.SAMPLE_CAP);
      tx.set(this.ref(), {
        // Une piste cloud qui finit = une manche jouée (le cloud répond toujours).
        rounds: (cur.rounds as number) + (lane === 'cloud' ? 1 : 0),
        correctVotes: (cur.correctVotes as number) ?? 0,
        localSamples: lane === 'local' ? trimmed : ((cur.localSamples as number[]) ?? []),
        cloudSamples: lane === 'cloud' ? trimmed : ((cur.cloudSamples as number[]) ?? []),
        lastDay: day,
        updatedAtMs: Date.now(),
      });
    });
  }

  async recordVote(day: string, correct: boolean) {
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(this.ref());
      const cur = snap.data() ?? { rounds: 0, correctVotes: 0, localSamples: [], cloudSamples: [] };
      tx.set(this.ref(), { ...cur, correctVotes: ((cur.correctVotes as number) ?? 0) + (correct ? 1 : 0), lastDay: day });
    });
  }

  async totals() {
    const snap = await this.ref().get();
    const d = snap.data() ?? {};
    return {
      rounds: (d.rounds as number) ?? 0,
      correctVotes: (d.correctVotes as number) ?? 0,
      localSamples: (d.localSamples as number[]) ?? [],
      cloudSamples: (d.cloudSamples as number[]) ?? [],
    };
  }
}
