import { NextRequest, NextResponse } from 'next/server';
import { buildApp } from '@/main/builder';
import { clientIp } from '@infrastructure/http/clientIp';
import { AlreadyPlayingError, DomainError, PromptEmptyError, PromptTooLongError, QuotaExhaustedError, RateLimitedError } from '@domain/entities/round';

export const runtime = 'nodejs';
const app = buildApp();

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  try {
    const { prompt } = (await req.json()) as { prompt?: string };
    if (typeof prompt !== 'string') throw new PromptEmptyError();
    const result = await app.startRound({ prompt, ip });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PromptEmptyError || err instanceof PromptTooLongError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof RateLimitedError || err instanceof AlreadyPlayingError) return NextResponse.json({ error: err.message }, { status: 429 });
    if (err instanceof QuotaExhaustedError) return NextResponse.json({ error: err.message }, { status: 429 });
    if (err instanceof DomainError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('startRound', err);
    return NextResponse.json({ error: 'erreur interne' }, { status: 500 });
  }
}
