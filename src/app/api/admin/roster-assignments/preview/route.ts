import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import {
  AdminRosterError,
  adminRosterAssignmentRequestSchema,
  previewAdminRosterAssignment
} from '@/lib/admin-roster';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = adminRosterAssignmentRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Select a valid Player and destination.' }, { status: 400 });
  }

  try {
    const plan = await previewAdminRosterAssignment(session.user.id, parsed.data);
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    if (error instanceof AdminRosterError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Admin roster assignment preview failed', error);
    return NextResponse.json(
      { error: 'Unable to preview the roster assignment. No data was changed.' },
      { status: 500 }
    );
  }
}
