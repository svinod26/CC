import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadEmailMapping } from '@/lib/email-mapping';
import { canonicalizeEmail, emailCandidates, normalizeEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  email: z.string().email()
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

  const email = normalizeEmail(parsed.data.email);
  const canonicalEmail = canonicalizeEmail(email);
  const candidateEmails = emailCandidates(email);
  try {
    const mapping = loadEmailMapping();
    const entry = mapping.get(email) ?? mapping.get(canonicalEmail);
    if (entry) {
      return NextResponse.json({ found: true, name: entry.name });
    }
  } catch (error) {
    console.error('Lookup email mapping load failed; falling back to database lookup', error);
  }

  const player = await prisma.player.findFirst({
    where: {
      OR: candidateEmails.map((candidate) => ({
        email: { equals: candidate, mode: 'insensitive' }
      }))
    },
    select: { name: true }
  });
  if (player?.name) {
    return NextResponse.json({ found: true, name: player.name });
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: candidateEmails.map((candidate) => ({
        email: { equals: candidate, mode: 'insensitive' }
      }))
    },
    select: { name: true }
  });
  if (user?.name) {
    return NextResponse.json({ found: true, name: user.name });
  }

  return NextResponse.json({ found: false });
}
