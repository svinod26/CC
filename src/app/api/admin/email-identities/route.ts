import { authOptions } from '@/lib/auth';
import {
  AdminEmailIdentityError,
  updateAdminEmailIdentity
} from '@/lib/admin-email-identity';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const updateSchema = z
  .object({
    targetType: z.enum(['PLAYER', 'USER']),
    targetId: z.string().min(1).max(100),
    email: z.string().trim().email().max(254),
    expectedCurrentEmail: z.string().trim().email().max(254).nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.targetType === 'USER' && value.expectedCurrentEmail === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedCurrentEmail'],
        message: 'Registered users must have a current email.'
      });
    }
  });

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email update payload.' }, { status: 400 });
  }

  try {
    const result = await updateAdminEmailIdentity({
      actorUserId: session.user.id,
      ...parsed.data
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof AdminEmailIdentityError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Admin email update failed', error);
    return NextResponse.json(
      { error: 'Email update failed without changing any account data.' },
      { status: 500 }
    );
  }
}
