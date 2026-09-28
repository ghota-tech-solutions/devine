import { NextResponse } from 'next/server';
import { buildApp } from '@/main/builder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const app = buildApp();

/** État de la file, affiché avant même de poser une question. */
export async function GET() {
  const { running, waiting } = app.queueStatus();
  return NextResponse.json({ running, waiting });
}
