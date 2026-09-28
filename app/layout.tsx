import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Local ou Cloud ? — devine quel modèle répond',
  description:
    'Deux modèles répondent en direct, côte à côte. Qwen 3.8 Flash Next tourne en local sur un MacBook M5 Max à Lyon, Gemini 3.8 Flash dans le cloud de Google. Devine lequel est le Mac.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
