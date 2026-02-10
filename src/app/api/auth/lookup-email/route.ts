import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadEmailMapping } from '@/lib/email-mapping';

const schema = z.object({
  email: z.string().email()
});

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ found: false }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const mapping = loadEmailMapping();
  const entry = mapping.get(email);
  if (!entry) {
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({ found: true, name: entry.name });
}
