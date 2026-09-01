import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { AdminSeasonImportError, commitSeasonImport } from '@/lib/admin-season-import';
import { seasonImportDraftSchema } from '@/lib/excel';

const commitSchema = z.object({
  draft: seasonImportDraftSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reviewed: z.literal(true)
}).strict();

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = commitSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Review and validate the complete import before confirming.' }, { status: 400 });
  }

  try {
    const result = await commitSeasonImport({
      actorUserId: session.user.id,
      draft: parsed.data.draft,
      fingerprint: parsed.data.fingerprint
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof AdminSeasonImportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Season import failed', error);
    return NextResponse.json({ error: 'Import failed without changing League data.' }, { status: 500 });
  }
}
