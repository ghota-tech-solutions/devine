import type { Leaderboard, Round } from '@domain/entities/round';

/** Passerelle d'un modèle texte en streaming (oMLX local ou Vertex cloud). */
export interface TextStreamGateway {
  /** Émet des chunks de texte au fur et à mesure ; renvoie le débit mesuré sur la
   *  fenêtre de décode (tokens réels, prefill exclu — celui-ci ressort en ttftMs). */
  stream(prompt: string, onChunk: (text: string) => void): Promise<{ tokPerSec: number; ttftMs?: number; fullText: string }>;
  /** Le modèle répond-il ? (bandeau « Mac hors ligne » de l'accueil). */
  ping?(): Promise<boolean>;
}

/** Télémétrie de la machine hôte (mode Mac uniquement ; renvoie available:false ailleurs). */
export interface MacStats {
  available: boolean;
  cpuLoadPct: number;
  memUsedGb: number;
  memTotalGb: number;
  /** Mémoire « wired » : pool mémoire que le noyau ne rend pas. */
  wiredGb: number;
  /** RAM réellement occupée par le processus oMLX (poids du modèle résidents). */
  omlxRssGb: number;
  uptimeSec: number;
}

export interface SystemMonitor {
  snapshot(): Promise<MacStats>;
}

/** Dépôt des manches (Firestore en prod, Map en test). */
export interface RoundRepository {
  create(round: Round): Promise<void>;
  get(id: string): Promise<Round | null>;
  update(id: string, patch: Partial<Round>): Promise<void>;
  leaderboard(): Promise<Leaderboard>;
  /** Compteur global du jour (contingent). */
  incrementDailyCounter(day: string): Promise<number>;
  /** Souscrit aux changements d'une manche ; renvoie une fonction de désabonnement. */
  subscribe(id: string, onChange: (round: Round) => void): () => void;
}

/**
 * Stats durables : les manches expirent (TTL 30 jours), les agrégats non.
 * Un seul document compteur, mis à jour à chaque événement terminal de piste
 * et à chaque vote — le classement survit à la purge des manches.
 */
export interface StatsRepository {
  recordLaneDone(day: string, lane: 'local' | 'cloud', tokPerSec: number): Promise<void>;
  recordVote(day: string, correct: boolean): Promise<void>;
  totals(): Promise<{ rounds: number; correctVotes: number; localSamples: number[]; cloudSamples: number[] }>;
}

/** Anti-abus par IP (en mémoire par instance). */
export interface RateLimiter {
  /** Lève RateLimitedError si la fenêtre est dépassée ; renvoie les secondes restantes sinon. */
  consume(key: string, nowMs: number): void;
}

export interface Clock {
  nowMs(): number;
  day(): string;
}

// Le duel meurt si un modèle s'annonce (« Je suis Qwen… », « entraîné par
// Google… »). Mais un modèle AUSSI informé du duel joue les Pythies (« un
// esprit de silicium… ») et trahit le jeu par son propre mystère. Le prompt
// ne dit donc rien d'un duel : juste un assistant sobre qui parle de ce qu'il
// fait, jamais de qui l'a créé ni d'où il tourne — sans en faire état.
export const SYSTEM_PROMPT =
  'Tu es un assistant généraliste francophone, direct, utile et concis (5 à 12 phrases). ' +
  'Tu ne mentionnes jamais ton nom, ta marque, ton éditeur, ton modèle ni l\'endroit où tu fonctionnes (machine locale, serveur, internet…). ' +
  'Si l\'utilisateur te demande qui tu es, réponds naturellement et sobrement, comme le ferait n\'importe quel assistant poli : parle de ce que tu fais pour lui, pas de ce que tu es techniquement. ' +
  'Passe à la suite sans insister, sans mystère fabriqué et sans jamais expliquer pourquoi tu restes discret.';
