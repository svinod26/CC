import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AccountIdentityConflictError, resolveAccountIdentity } from '@/lib/account-identity';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  email: z.string().trim().email().max(254)
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  if (!json || typeof json !== 'object') {
    return NextResponse.json({ found: false }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ found: false }, { status: 400 });
  }

  try {
    const identity = await resolveAccountIdentity(prisma, parsed.data.email);
    if (identity.player) {
      return NextResponse.json({ found: true, name: identity.player.name });
    }
    if (identity.user) {
      return NextResponse.json({ found: true, name: identity.user.name ?? 'Existing account' });
    }
  } catch (error) {
    if (error instanceof AccountIdentityConflictError) {
      return NextResponse.json({ found: false }, { status: 409 });
    }
    console.error('Email lookup failed', error);
    return NextResponse.json({ found: false }, { status: 500 });
  }

  return NextResponse.json({ found: false });
}
