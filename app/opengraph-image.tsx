import { ImageResponse } from 'next/og';

// Image de partage (LinkedIn, X, messageries). Pas d'emoji : ils seraient
// téléchargés au rendu ; formes et texte seulement.
export const alt = 'Local ou Cloud ? Deux IA répondent côte à côte, devine laquelle tourne sur un Mac.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const card = (color: string, name: string, where: string, detail: string) => (
  <div
    style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      width: 420, height: 220, borderRadius: 28, border: `3px solid ${color}`,
      background: 'rgba(255,255,255,0.04)',
    }}
  >
    <div style={{ fontSize: 40, fontWeight: 800, color }}>{name}</div>
    <div style={{ fontSize: 22, letterSpacing: 4, color: '#eceae4', marginTop: 14 }}>{where}</div>
    <div style={{ fontSize: 22, color: '#8b919d', marginTop: 8 }}>{detail}</div>
  </div>
);

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', background: '#05070b', color: '#eceae4',
          backgroundImage: 'radial-gradient(circle at 20% 0%, rgba(52,227,160,0.18), transparent 55%), radial-gradient(circle at 85% 0%, rgba(90,168,255,0.2), transparent 55%)',
        }}
      >
        <div style={{ fontSize: 24, letterSpacing: 8, color: '#8b919d' }}>DEUX IA, UNE QUESTION</div>
        <div style={{ display: 'flex', fontSize: 104, fontWeight: 800, marginTop: 10, letterSpacing: -3 }}>
          <span style={{ color: '#34e3a0' }}>Local</span>
          <span style={{ color: '#eceae4', margin: '0 26px' }}>ou</span>
          <span style={{ color: '#5aa8ff' }}>Cloud ?</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 40 }}>
          {card('#34e3a0', 'Qwen 3.8 Flash Next', 'EN LOCAL', 'MacBook Pro M5 Max, Lyon')}
          <div style={{ fontSize: 36, fontWeight: 800, color: '#8b919d', margin: '0 36px' }}>VS</div>
          {card('#5aa8ff', 'Gemini 3.8 Flash', 'DANS LE CLOUD', 'data center Google')}
        </div>
        <div style={{ fontSize: 28, color: '#eceae4', marginTop: 40 }}>Devine laquelle tourne sur le Mac.</div>
        <div style={{ fontSize: 20, color: '#8b919d', marginTop: 12 }}>devine.ghotatechsolutions.com</div>
      </div>
    ),
    size,
  );
}
