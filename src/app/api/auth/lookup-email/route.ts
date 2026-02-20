import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadEmailMapping } from '@/lib/email-mapping';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  email: z.string().email()
});
const canonicalizeEmail = (value: string) => {
  const normalized = value.trim().toLowerCase();
  const atIndex = normalized.indexOf('@');
  if (atIndex < 1) return normalized;
  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const withoutTag = local.split('+')[0] ?? local;
    const withoutDots = withoutTag.replace(/\./g, '');
    return `${withoutDots}@gmail.com`;
  }
  return normalized;
};

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  if (!json || typeof json !== 'object') {
    return NextResponse.json({ found: false }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ found: false }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const canonicalEmail = canonicalizeEmail(email);
  const candidateEmails = canonicalEmail === email ? [email] : [email, canonicalEmail];
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
