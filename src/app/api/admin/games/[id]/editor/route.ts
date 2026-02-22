import { authOptions } from '@/lib/auth';
import { getAdminGameSnapshot } from '@/lib/admin-editor';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const snapshot = await getAdminGameSnapshot(params.id);
  if (!snapshot) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }

  if (snapshot.game.statsSource !== 'TRACKED' || snapshot.game.status !== 'FINAL') {
    return NextResponse.json({ error: 'Only finalized tracked games are editable here' }, { status: 400 });
  }

  return NextResponse.json(snapshot);
}
