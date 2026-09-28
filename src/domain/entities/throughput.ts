// Mesure de débit — la même formule partout, testable sans réseau.
//
// Le débit affiché doit être comparable à celui du tableau de bord oMLX :
// des tokens réels sur la FENÊTRE DE DÉCODE (premier token → dernier token),
// pas des mots sur une durée incluant la mise en file d'attente et le prefill.

export interface ThroughputInput {
  startedAtMs: number;
  firstTokenAtMs: number | null;
  lastTokenAtMs: number | null;
  /** tokens réels (usage.completion_tokens) si fournis par le fournisseur. */
  completionTokens?: number;
  fullText: string;
}

export interface Throughput {
  tokPerSec: number;
  /** Temps jusqu'au premier token (prefill + file d'attente). */
  ttftMs: number | null;
  tokens: number;
}

/** Heuristique ~4 caractères = 1 token quand le fournisseur ne renvoie pas d'usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function measureThroughput(i: ThroughputInput): Throughput {
  const ttftMs = i.firstTokenAtMs !== null ? Math.max(0, i.firstTokenAtMs - i.startedAtMs) : null;
  const decodeSec =
    i.firstTokenAtMs !== null && i.lastTokenAtMs !== null
      ? Math.max(0, i.lastTokenAtMs - i.firstTokenAtMs) / 1000
      : 0;
  const tokens = i.completionTokens && i.completionTokens > 0 ? i.completionTokens : estimateTokens(i.fullText);
  // Sous 0,2 s de décode le ratio n'a pas de sens — on l'affiche pas.
  const tokPerSec = decodeSec >= 0.2 ? Math.round(tokens / decodeSec) : 0;
  return { tokPerSec, ttftMs, tokens };
}
