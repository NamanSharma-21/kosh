import { createHmac, randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { fromB64 } from '@/lib/crypto/base64';
import { ingestAad } from '@/lib/crypto/envelope';
import { seal } from '@/lib/crypto/ecies';
import { parseUpiMessage } from '@/lib/ingest/parse-upi';
import { createAnonClient } from '@/lib/supabase/server';
import type { IngestPayload } from '@/lib/domain/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024;
const TOKEN_RE = /^kosh_[A-Za-z0-9_-]{43}$/;

const Body = z.object({
  text: z.string().min(1).max(2000),
  from: z.string().max(60).optional(),
  ts: z.union([z.string(), z.number()]).optional(),
});

const reply = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Receives a bank/UPI SMS or notification forwarded from the user's phone.
 *
 * The server parses it (briefly holding plaintext in memory) and immediately
 * seals the result to the user's PUBLIC key, so only their unlocked browser can
 * read it. Nothing is logged. Message bodies are never persisted in the clear.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!TOKEN_RE.test(token)) return reply(401, { status: 'invalid_token' });

  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BYTES) return reply(413, { status: 'too_large' });

  let input: z.infer<typeof Body>;
  try {
    const type = req.headers.get('content-type') ?? '';
    const json = type.includes('application/json') ? JSON.parse(raw) : { text: raw };
    const parsed = Body.safeParse(json);
    if (!parsed.success) return reply(400, { status: 'bad_request' });
    input = parsed.data;
  } catch {
    return reply(400, { status: 'bad_request' });
  }

  const parsed = parseUpiMessage(input.text);
  if (!parsed) return reply(200, { status: 'ignored' });

  const db = await createAnonClient();
  const { data: prep, error: prepError } = await db.rpc('ingest_prepare', { p_token: token });
  if (prepError) return reply(500, { status: 'error' });
  const owner = Array.isArray(prep) ? prep[0] : prep;
  if (!owner) return reply(401, { status: 'invalid_token' });

  const id = randomUUID();
  const payload: IngestPayload = {
    ...parsed,
    receivedAt: new Date().toISOString(),
    text: input.text,
  };
  const sealed = await seal(fromB64(owner.public_key), payload, ingestAad(owner.user_id, id));

  // Same payment reported twice (SMS + app notification, or a retry) → one event.
  const secret = process.env.INGEST_DEDUPE_SECRET;
  let dedupe: string | null = null;
  if (secret) {
    const basis = parsed.ref
      ? `${owner.user_id}|${parsed.ref}|${parsed.direction}`
      : `${owner.user_id}|${parsed.date ?? ''}|${parsed.amount}|${parsed.merchant}|${parsed.direction}|${input.ts ?? ''}`;
    dedupe = createHmac('sha256', secret).update(basis).digest('hex');
  }

  const { data: result, error } = await db.rpc('ingest_store', {
    p_token: token,
    p_id: id,
    p_sealed: sealed,
    p_dedupe: dedupe,
  });
  if (error) return reply(500, { status: 'error' });

  switch (result) {
    case 'stored':
      return reply(200, { status: 'stored' });
    case 'duplicate':
      return reply(200, { status: 'duplicate' });
    case 'rate_limited':
      return reply(429, { status: 'rate_limited' });
    default:
      return reply(401, { status: 'invalid_token' });
  }
}
