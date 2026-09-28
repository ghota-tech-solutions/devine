import type { Metadata } from 'next';
import './globals.css';

const TITLE = 'Local ou Cloud ? — devine quel modèle répond';
const DESCRIPTION =
  'Deux IA répondent en direct, côte à côte : Qwen 3.8 Flash Next en local sur un MacBook M5 Max à Lyon, Gemini 3.8 Flash dans le cloud de Google. Devine laquelle est le Mac.';

export const metadata: Metadata = {
  metadataBase: new URL('https://devine.ghotatechsolutions.com'),
  title: TITLE,
  description: DESCRIPTION,
  authors: [{ name: 'Mickael Villers', url: 'https://ghotatechsolutions.com' }],
  // Image de partage : app/opengraph-image.tsx (générée par Next au build).
  openGraph: {
    type: 'website',
    locale: 'fr_FR',
    url: '/',
    siteName: 'Local ou Cloud ?',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    creator: '@MickaelV79228',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
