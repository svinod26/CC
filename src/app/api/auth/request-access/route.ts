import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { loadEmailMapping } from '@/lib/email-mapping';
import { sendResendEmail } from '@/lib/resend';

const requestSchema = z.object({
  email: z.string().email()
});

const generatePassword = () => randomBytes(9).toString('base64url');

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const mapping = loadEmailMapping();
  const entry = mapping.get(email);

  if (!entry) {
    return NextResponse.json({ error: 'Email not found in roster' }, { status: 404 });
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        name: entry.name
      }
    });
  } else {
    await prisma.user.create({
      data: {
        email,
        name: entry.name,
        passwordHash,
        role: 'USER'
      }
    });
  }

  const player = await prisma.player.findFirst({ where: { email } });
  if (!player && entry.name) {
    const byName = await prisma.player.findFirst({ where: { name: entry.name } });
    if (byName && !byName.email) {
      await prisma.player.update({ where: { id: byName.id }, data: { email } });
    }
  }

  const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const subject = 'Century Cup login details';
  const text = `Hey ${entry.name},

Your Century Cup account is ready.

Login: ${email}
Password: ${password}

Sign in: ${appUrl}/signin

You can change your password later from your profile.`;

  const html = `
    <div style="font-family:Arial, sans-serif; color:#241a1a;">
      <h2 style="margin:0 0 12px;">Century Cup login details</h2>
      <p>Hey ${entry.name},</p>
      <p>Your Century Cup account is ready.</p>
      <p><strong>Login:</strong> ${email}<br/>
         <strong>Password:</strong> ${password}</p>
      <p><a href="${appUrl}/signin">Sign in here</a></p>
    </div>
  `;

  try {
    await sendResendEmail({ to: email, subject, html, text });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
