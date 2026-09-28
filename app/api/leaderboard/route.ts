import { NextResponse } from 'next/server';
import { buildApp } from '@/main/builder';

export const runtime = 'nodejs';
const app = buildApp();

export async function GET() {
  return NextResponse.json(await app.getLeaderboard());
}
