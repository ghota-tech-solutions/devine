import { buildApp } from '@/main/builder';

export const runtime = 'nodejs';
const app = buildApp();

/** Télémétrie du Mac (CPU/RAM/wired) — dispo uniquement quand le serveur tourne sur le Mac. */
export async function GET() {
  return Response.json(await app.getMacStats());
}
