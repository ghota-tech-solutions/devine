import { NextResponse } from 'next/server';
import { buildApp } from '@/main/builder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const app = buildApp();

/** Le Mac répond-il ? Affiché sur l'accueil (« Le Mac est hors ligne »). */
export async function GET() {
  return NextResponse.json({ online: await app.macOnline() });
}
