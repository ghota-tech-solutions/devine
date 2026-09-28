import { NextRequest, NextResponse } from 'next/server';
import { buildApp } from '@/main/builder';

export const runtime = 'nodejs';
const app = buildApp();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { choice } = (await req.json().catch(() => ({}))) as { choice?: 'left' | 'right' | 'tie' };
  if (!choice || !['left', 'right', 'tie'].includes(choice)) {
    return NextResponse.json({ error: 'choix invalide' }, { status: 400 });
  }
  try {
    const round = await app.castVote({ roundId: id, choice });
    return NextResponse.json({ state: round.machine.state, correct: round.vote?.correct });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 409 });
  }
}
