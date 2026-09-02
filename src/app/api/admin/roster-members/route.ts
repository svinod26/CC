import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import {
  AdminRosterError,
  addAdminRosterPlayer,
  adminRosterAdditionConfirmationSchema,
  adminRosterRequestSchema
} from '@/lib/admin-roster';

const commitSchema = adminRosterRequestSchema.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmations: z.array(adminRosterAdditionConfirmationSchema).max(1).default([])
}).strict();

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = commitSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid roster update payload.' }, { status: 400 });
  }

  const { fingerprint, confirmations, ...request } = parsed.data;
  try {
    const result = await addAdminRosterPlayer({
      actorUserId: session.user.id,
      request,
      fingerprint,
      confirmations
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof AdminRosterError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Admin new player creation failed', error);
    return NextResponse.json(
      { error: 'Player creation failed without changing any player or roster data.' },
      { status: 500 }
    );
  }
}
