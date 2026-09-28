'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

type Side = 'left' | 'right';
/** Vue publique d'une piste : rangée par position, jamais par « Mac » ou « nuage ». */
interface Lane { text: string; done: boolean; tokPerSec?: number; ttftMs?: number; failed: boolean; error?: string; reasoning?: string }
/** `macSide` n'arrive qu'avec la révélation. */
interface PublicRound { state: string; lanes: Record<Side, Lane>; macSide?: Side }
const SIDES: Side[] = ['left', 'right'];
interface Leaderboard {
  rounds: number;
  correctVotes: number;
  medianLocalTokPerSec: number;
  medianCloudTokPerSec: number;
}
interface MacStats {
  available: boolean;
  cpuLoadPct: number;
  memUsedGb: number;
  memTotalGb: number;
  wiredGb: number;
  omlxRssGb: number;
  uptimeSec: number;
}
interface QueueInfo { position: number | null; running: number; waiting: number }
type Phase = 'ask' | 'queue' | 'race' | 'vote' | 'reveal' | 'over';

const GITHUB_URL = 'https://github.com/ghota-tech-solutions/devine';
const CONTACT = {
  name: 'Mickael Villers',
  company: 'Ghota Tech Solutions',
  site: 'https://ghotatechsolutions.com',
  linkedin: 'https://www.linkedin.com/in/mickaelvillers',
  x: 'https://x.com/MickaelV79228',
  email: 'contact@ghotatechsolutions.com',
};
const MAC_MODEL = 'Qwen 3.8 Flash Next';
const CLOUD_MODEL = 'Gemini 3.8 Flash';
const HIST = 90; // ~3 min à 2 s d'intervalle
const EXAMPLES = [
  'Explique la photosynthèse à un enfant de 8 ans.',
  'Écris un haïku sur un lundi matin.',
  'Trois idées de dîner rapide avec des pâtes.',
  'Pourquoi le ciel est-il bleu ?',
];
const STEPS: { key: Phase[]; label: string }[] = [
  { key: ['ask'], label: 'Pose ta question' },
  { key: ['queue'], label: 'File d’attente' },
  { key: ['race'], label: 'Les deux IA répondent' },
  { key: ['vote'], label: 'Devine le Mac' },
  { key: ['reveal', 'over'], label: 'Verdict' },
];

/** Markdown → HTML assaini (le texte sort d'un modèle piloté par des prompts de visiteurs). */
function Markdown({ text }: { text: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true, gfm: true }) as string),
    [text],
  );
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Sparkline({ data, max, color }: { data: number[]; max: number; color: string }) {
  if (data.length < 2) return <svg className="spark" />;
  const w = 300;
  const h = 34;
  const m = Math.max(max, ...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / m) * (h - 3) - 1.5}`);
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={color} opacity="0.14" />
      <polyline points={pts.join(' ')} stroke={color} />
    </svg>
  );
}

/** Barres horizontales comparées. `lowerIsBetter` inverse la lecture (délai). */
function Bars({ rows, unit, lowerIsBetter = false }: {
  rows: { label: string; value: number; tone: 'mac' | 'cloud' | 'neutral' }[];
  unit: string;
  lowerIsBetter?: boolean;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  const valid = rows.filter((r) => r.value > 0);
  const best = valid.length === rows.length
    ? (lowerIsBetter ? Math.min(...valid.map((r) => r.value)) : Math.max(...valid.map((r) => r.value)))
    : null;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.label} className={`bar-row ${r.tone}`}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${r.value > 0 ? Math.max(3, (r.value / max) * 100) : 0}%` }} />
          </span>
          <span className="bar-value">
            {r.value > 0 ? `${Math.round(r.value).toLocaleString('fr-FR')} ${unit}` : '—'}
            {best !== null && r.value === best && <em> ★</em>}
          </span>
        </div>
      ))}
    </div>
  );
}

const fmtUptime = (s: number) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d > 0 ? `${d} j ${h} h` : `${h} h ${Math.floor((s % 3600) / 60)} min`;
};
/** GET JSON tolérant : une route en erreur ne doit jamais casser la page. */
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const fmtRatio = (a: number, b: number) => (a / b).toLocaleString('fr-FR', { maximumFractionDigits: 1 });

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [roundId, setRoundId] = useState<string | null>(null);
  const [round, setRound] = useState<PublicRound | null>(null);
  const [macOnline, setMacOnline] = useState<boolean | null>(null);
  const [queue, setQueue] = useState<QueueInfo | null>(null);
  const [globalQueue, setGlobalQueue] = useState<{ running: number; waiting: number } | null>(null);
  const [myVote, setMyVote] = useState<{ choice: Side | 'tie'; correct: boolean } | null>(null);
  const [askedPrompt, setAskedPrompt] = useState('');
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [stats, setStats] = useState<MacStats | null>(null);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [memHist, setMemHist] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [mac, lb, q] = await Promise.all([
      getJson<{ online: boolean }>('/api/mac/status'),
      getJson<Leaderboard>('/api/leaderboard'),
      getJson<{ running: number; waiting: number }>('/api/queue'),
    ]);
    if (mac) setMacOnline(mac.online);
    if (lb) setBoard(lb);
    if (q) setGlobalQueue(q);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Télémétrie (la machine SERVEUSE parle — elle héberge peut-être une des
  // deux pistes, c'est tout ce qu'on en dit).
  useEffect(() => {
    let stop = false;
    const pull = async () => {
      const s = await getJson<MacStats>('/api/mac/stats');
      if (stop || !s) return;
      setStats(s);
      if (s.available) {
        setCpuHist((h) => [...h.slice(-(HIST - 1)), s.cpuLoadPct]);
        setMemHist((h) => [...h.slice(-(HIST - 1)), s.memUsedGb]);
      }
    };
    pull();
    const t = setInterval(pull, 2000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const watchRound = useCallback((id: string) => {
    const es = new EventSource(`/api/rounds/${id}/stream`);
    es.addEventListener('queue', (e) => {
      try { setQueue(JSON.parse(e.data)); } catch { /* événement tronqué */ }
    });
    es.addEventListener('round', (e) => {
      let d: unknown;
      try { d = JSON.parse(e.data); } catch { return; }
      const d2 = d as PublicRound;
      const state = d2.state;
      setRound(d2);
      if (state !== 'queued') setQueue(null);
      if (['revealed', 'expired', 'failed'].includes(state)) { es.close(); void refresh(); }
    });
    es.onerror = () => es.close();
    return es;
  }, [refresh]);

  const start = useCallback(async (rawPrompt: string) => {
    const p = rawPrompt.trim();
    if (!p) return;
    setError(null);
    setRound(null);
    setRoundId(null);
    setMyVote(null);
    setAskedPrompt(p);
    try {
      const res = await fetch('/api/rounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p }),
      });
      const data = await res.json().catch(() => ({ error: 'Réponse illisible du serveur.' }));
      if (!res.ok) { setError(data.error ?? 'erreur'); return; }
      setQueue({ position: data.queuePosition, running: data.queuePosition > 0 ? 1 : 0, waiting: data.queuePosition });
      setRoundId(data.roundId);
      sessionStorage.setItem('devine_round', data.roundId);
      watchRound(data.roundId);
    } catch {
      setError('Le serveur ne répond pas.');
    }
  }, [watchRound]);

  // Au chargement : ?q=… lance la course direct (pratique à filmer), sinon on
  // rejoint la manche en cours si le visiteur a rechargé la page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) { setPrompt(q.slice(0, 1500)); void start(q.slice(0, 1500)); return; }
    const r = params.get('r'); // rejoindre une manche précise (partage, film)
    if (r) { setRoundId(r); watchRound(r); return; }
    const saved = sessionStorage.getItem('devine_round');
    if (saved) { setRoundId(saved); watchRound(saved); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = useCallback(() => start(prompt), [start, prompt]);

  const vote = useCallback(
    async (choice: Side | 'tie') => {
      if (!roundId) return;
      const data = await fetch(`/api/rounds/${roundId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice }),
      }).then((r) => r.json()).catch(() => ({})) as Partial<PublicRound> & { correct?: boolean };
      // La réponse du vote porte la révélation (côté du Mac, mesures finales).
      if (!data.lanes || !data.state) { setError('Vote non pris en compte, réessaie.'); return; }
      setMyVote({ choice, correct: !!data.correct });
      setRound({ state: data.state, lanes: data.lanes, macSide: data.macSide });
      setRoundId(null);
      setPrompt('');
      sessionStorage.removeItem('devine_round');
      void refresh();
    },
    [roundId, refresh],
  );

  const reset = useCallback(() => {
    setRound(null);
    setRoundId(null);
    setMyVote(null);
    setQueue(null);
    sessionStorage.removeItem('devine_round');
  }, []);

  const state = round?.state;
  const phase: Phase =
    state === 'revealed' ? 'reveal'
      : state === 'expired' || state === 'failed' ? 'over'
        : state === 'awaiting_vote' ? 'vote'
          : state === 'live' ? 'race'
            : roundId ? 'queue'
              : 'ask';
  const revealed = phase === 'reveal' && !!round?.macSide;
  const macSide = round?.macSide;
  const stepIndex = STEPS.findIndex((s) => s.key.includes(phase));

  // Avant la révélation : mêmes titres neutres, mêmes couleurs, même rendu.
  const lanes = SIDES.map((pos) => {
    const l = round?.lanes[pos] ?? { text: '', done: false, tokPerSec: 0, failed: false };
    return {
      pos,
      isMac: pos === macSide,
      name: pos === 'left' ? 'IA A' : 'IA B',
      lane: l,
      live: state === 'live' && !l.done && !l.failed,
    };
  });

  const macLane = macSide ? round?.lanes[macSide] : undefined;
  const cloudLane = macSide ? round?.lanes[macSide === 'left' ? 'right' : 'left'] : undefined;
  const macTpsFinal = macLane?.tokPerSec ?? 0;
  const cloudTpsFinal = cloudLane?.tokPerSec ?? 0;
  const macTtft = macLane?.ttftMs ?? 0;
  const cloudTtft = cloudLane?.ttftMs ?? 0;
  const rate = board && board.rounds > 0 ? Math.round((board.correctVotes / board.rounds) * 100) : null;

  return (
    <main>
      <header className="hero">
        <p className="kicker">Deux IA, une question</p>
        <h1>Local ou Cloud&nbsp;?</h1>
        <p className="tagline">
          Pose une question&nbsp;: <strong>deux IA répondent en même temps</strong>. L’une tourne sur un
          ordinateur portable posé à Lyon, l’autre dans les serveurs de Google. <strong>À toi de deviner
          laquelle est le Mac.</strong>
        </p>

        <div className="versus" aria-label="Les deux concurrents">
          <div className="fighter mac">
            <span className="icon">🖥️</span>
            <b>{MAC_MODEL}</b>
            <span className="where">en local</span>
            <small>MacBook Pro M5 Max à Lyon (oMLX)</small>
          </div>
          <span className="vs">VS</span>
          <div className="fighter cloud">
            <span className="icon">☁️</span>
            <b>{CLOUD_MODEL}</b>
            <span className="where">dans le cloud</span>
            <small>data center Google (Vertex AI)</small>
          </div>
        </div>
        <p className="hint">Pendant la course, les réponses s’appellent « IA A » et « IA B », tirées au sort à chaque manche.</p>

        <div className="status-row">
          <span className={`pill ${macOnline ? 'on' : macOnline === false ? 'off' : ''}`}>
            <span className="dot" />
            {macOnline ? 'Les deux IA sont prêtes' : macOnline === false ? 'Le Mac est hors ligne' : 'Connexion…'}
          </span>
          {globalQueue && (
            <span className="pill">
              {globalQueue.running + globalQueue.waiting === 0
                ? 'File vide, ta question part tout de suite'
                : `File : ${globalQueue.running} en cours · ${globalQueue.waiting} en attente`}
            </span>
          )}
        </div>
      </header>

      <ol className="steps" aria-label="Déroulé d’une manche">
        {STEPS.map((s, i) => (
          <li key={s.label} className={i < stepIndex ? 'past' : i === stepIndex ? 'now' : ''}>
            <span className="num">{i + 1}</span>
            <span className="lbl">{s.label}</span>
          </li>
        ))}
      </ol>

      {phase === 'ask' && (
        <section className="ask">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={1500}
            placeholder="Pose n’importe quelle question aux deux IA…"
            rows={3}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) play(); }}
          />
          <div className="examples">
            <span className="dim">Pas d’idée&nbsp;?</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} className="chip-btn" onClick={() => { setPrompt(ex); void start(ex); }}>{ex}</button>
            ))}
          </div>
          <div className="composer-row">
            <span className="count">{prompt.length} / 1500 · ⌘+Entrée</span>
            <button onClick={play} disabled={!prompt.trim()}>Lancer la course ▶</button>
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {phase === 'queue' && (
        <section className="queue-card" aria-live="polite">
          <p className="asked">« {askedPrompt || '…'} »</p>
          {queue && queue.position !== null && queue.position > 0 ? (
            <>
              <h2>Ta question est dans la file</h2>
              <div className="queue-line" aria-hidden>
                {Array.from({ length: queue.running }).map((_, i) => <span key={`r${i}`} className="q running" title="en cours" />)}
                {Array.from({ length: queue.position - 1 }).map((_, i) => <span key={`w${i}`} className="q" />)}
                <span className="q me">toi</span>
              </div>
              <p className="dim">
                {queue.position === 1
                  ? 'Ta question est la prochaine. Elle part dès que la manche en cours se termine.'
                  : `${queue.position - 1} question${queue.position > 2 ? 's' : ''} avant la tienne. Le Mac répond à une seule question à la fois pour que la mesure reste juste.`}
              </p>
              <p className="dim small">Garde la page ouverte, la course démarre toute seule.</p>
            </>
          ) : (
            <>
              <h2>Envoi aux deux IA…</h2>
              <div className="queue-line" aria-hidden><span className="q me">toi</span></div>
            </>
          )}
        </section>
      )}

      {round && (phase === 'race' || phase === 'vote' || phase === 'reveal') && (
        <>
          <p className="asked center">« {askedPrompt || 'ta question'} »</p>

          {phase === 'vote' && (
            <div className="vote-banner">
              <b>À toi&nbsp;!</b> Laquelle de ces deux réponses vient du Mac&nbsp;?
            </div>
          )}

          <section className="race">
            {lanes.map(({ pos, isMac, name, lane, live }) => (
              <div
                key={pos}
                className={`lane ${revealed ? (isMac ? 'is-mac' : 'is-cloud') : ''} ${live ? 'streaming' : ''} ${lane.done ? 'done' : ''}`}
              >
                <span className="bar" />
                <div className="lane-head">
                  <span className="lane-title">
                    <span className="dot" />
                    {name}
                    {revealed && <em className="who">{isMac ? `🖥️ ${MAC_MODEL} (Mac)` : `☁️ ${CLOUD_MODEL}`}</em>}
                  </span>
                  {/* Les chiffres trahiraient le Mac : seulement après le vote. */}
                  {revealed ? (
                    <span>
                      <span className="tps">{lane.tokPerSec ? lane.tokPerSec : '—'}<small>{lane.tokPerSec ? ' tok/s' : ''}</small></span>
                      <span className="ttft">1ᵉʳ mot en {lane.ttftMs ?? '?'} ms</span>
                    </span>
                  ) : (
                    <span className="ttft">{lane.done ? 'a fini' : lane.text ? 'écrit…' : 'thinking…'}</span>
                  )}
                </div>
                {lane.text
                  ? <Markdown text={lane.text} />
                  : lane.failed
                    ? <p className="error">⚠️ Cette IA n’a pas répondu{lane.error ? ` (${lane.error})` : ''}</p>
                    // Même indicateur sur les deux pistes tant qu'aucun mot n'est écrit.
                    : <span className="thinking">💭 thinking<span className="dots" aria-hidden><i>.</i><i>.</i><i>.</i></span></span>}
                {live && lane.text && <span className="caret" />}
                {phase === 'vote' && (
                  <button className="pick" onClick={() => vote(pos)}>🖥️ C’est le Mac&nbsp;!</button>
                )}
              </div>
            ))}
          </section>

          {phase === 'vote' && (
            <p className="center">
              <button className="ghost" onClick={() => vote('tie')}>Aucune idée, révèle-moi</button>
              {error && <span className="error" style={{ display: 'block', marginTop: '.6rem' }}>{error}</span>}
            </p>
          )}

          {revealed && (
            <section className="reveal">
              {myVote && (
                <p className={`verdict ${myVote.choice === 'tie' ? '' : myVote.correct ? 'good' : 'bad'}`}>
                  {myVote.choice === 'tie' ? '🤷 Pas de pari cette fois.' : myVote.correct ? '✅ Bien vu, c’était le Mac !' : '❌ Raté, c’était l’autre !'}
                </p>
              )}
              <p className="sub">
                Le Mac ({MAC_MODEL}) était <b>{macSide === 'left' ? 'l’IA A (à gauche)' : 'l’IA B (à droite)'}</b>.
                {macTpsFinal > 0 && cloudTpsFinal > 0 && (
                  <> {macTpsFinal >= cloudTpsFinal
                    ? `Il a écrit ${fmtRatio(macTpsFinal, cloudTpsFinal)}× plus vite que ${CLOUD_MODEL}, sans passer par un data center.`
                    : `${CLOUD_MODEL} a écrit ${fmtRatio(cloudTpsFinal, macTpsFinal)}× plus vite que le Mac.`}</>
                )}
              </p>

              <div className="charts">
                <div>
                  <div className="section-title">Vitesse d’écriture <small>plus long = plus rapide</small></div>
                  <Bars unit="tok/s" rows={[
                    { label: '🖥️ Local', value: macTpsFinal, tone: 'mac' },
                    { label: '☁️ Cloud', value: cloudTpsFinal, tone: 'cloud' },
                  ]} />
                </div>
                <div>
                  <div className="section-title">Délai avant le 1ᵉʳ mot <small>plus court = mieux</small></div>
                  <Bars unit="ms" lowerIsBetter rows={[
                    { label: '🖥️ Local', value: macTtft, tone: 'mac' },
                    { label: '☁️ Cloud', value: cloudTtft, tone: 'cloud' },
                  ]} />
                </div>
              </div>
              {macLane?.reasoning && (
                <details className="reasoning">
                  <summary>💭 Voir la réflexion du Mac avant sa réponse</summary>
                  <p>{macLane.reasoning}</p>
                </details>
              )}
              <p className="footnote">
                Mesures brutes de cette manche, sans retouche. Le Mac part en premier et Gemini démarre quand
                le Mac écrit son premier mot ; chaque délai est compté depuis le départ de sa propre IA, trajet
                réseau compris. Le débit compte les tokens entre le premier et le dernier mot.
              </p>
              <button onClick={reset}>Rejouer ↻</button>
            </section>
          )}
        </>
      )}

      {phase === 'over' && (
        <section className="reveal">
          <p className="verdict bad">Cette manche n’a pas pu aller au bout.</p>
          <p className="sub">Une des IA a mis trop longtemps à répondre. Réessaie dans un instant.</p>
          <button onClick={reset}>Rejouer ↻</button>
        </section>
      )}

      {board && board.rounds > 0 && (
        <section className="board" aria-label="Résultats de tous les visiteurs">
          <div className="section-title">Tous les visiteurs <small>{board.rounds.toLocaleString('fr-FR')} manche{board.rounds > 1 ? 's' : ''} jouée{board.rounds > 1 ? 's' : ''}</small></div>
          {rate !== null && (
            <div className="gauge">
              <div className="gauge-head">
                <span>Mac démasqué</span>
                <b>{rate}&nbsp;%</b>
              </div>
              <div className="gauge-track">
                <span className="gauge-fill" style={{ width: `${rate}%` }} />
              </div>
              <p className="dim small">
                Part des manches jouées où le visiteur a désigné le bon côté (manches sans vote comprises).
              </p>
            </div>
          )}
          <div className="section-title">Vitesse médiane</div>
          <Bars unit="tok/s" rows={[
            { label: '🖥️ Local', value: board.medianLocalTokPerSec, tone: 'mac' },
            { label: '☁️ Cloud', value: board.medianCloudTokPerSec, tone: 'cloud' },
          ]} />
        </section>
      )}

      {stats?.available && (
        <section className="monitor" aria-label="Télémétrie de la machine locale">
          <div className="mon-cell">
            <div className="mon-label">CPU du Mac</div>
            <div className="mon-value">{stats.cpuLoadPct}<small>&nbsp;%</small></div>
            <Sparkline data={cpuHist} max={100} color="#5aa8ff" />
          </div>
          <div className="mon-cell">
            <div className="mon-label">RAM utilisée</div>
            <div className="mon-value">{stats.memUsedGb}<small>&nbsp;/ {stats.memTotalGb} Go</small></div>
            <Sparkline data={memHist} max={stats.memTotalGb} color="#8b919d" />
          </div>
          <div className="mon-cell">
            <div className="mon-label">Cette machine</div>
            <div className="mon-value" style={{ fontSize: '1rem' }}>porte une des deux IA</div>
            <div className="mon-label" style={{ marginTop: '.9rem' }}>laquelle&nbsp;? tout l’enjeu</div>
          </div>
          <div className="mon-cell">
            <div className="mon-label">Allumée depuis</div>
            <div className="mon-value" style={{ fontSize: '1rem' }}>{fmtUptime(stats.uptimeSec)}</div>
          </div>
        </section>
      )}

      <section className="contact" aria-label="Contact">
        <h2>Une IA locale chez toi&nbsp;?</h2>
        <p>
          Ce site est une démo : un modèle open source qui tourne sur une seule machine, sans envoyer tes
          données chez un fournisseur. Pour mettre en place la même chose dans ton entreprise (LLM privé,
          serveur dédié ou cloud maîtrisé), écris-moi.
        </p>
        <p className="who">
          <b>{CONTACT.name}</b> · ingénieur DevOps &amp; IA à Lyon · {CONTACT.company}
        </p>
        <div className="contact-links">
          <a className="contact-btn primary" href={`mailto:${CONTACT.email}?subject=${encodeURIComponent('IA locale — Local ou Cloud ?')}`}>
            ✉️ {CONTACT.email}
          </a>
          <a className="contact-btn" href={CONTACT.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a>
          <a className="contact-btn" href={CONTACT.x} target="_blank" rel="noopener noreferrer">X · @MickaelV79228</a>
          <a className="contact-btn" href={CONTACT.site} target="_blank" rel="noopener noreferrer">ghotatechsolutions.com</a>
        </div>
      </section>

      <footer className="credit">
        Débits mesurés, pas des promesses.{' '}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">Code source sur GitHub</a> (licence MIT)
        {' '}· Ghota Tech Solutions
      </footer>
    </main>
  );
}
