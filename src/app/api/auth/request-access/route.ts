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
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const canonicalEmail = canonicalizeEmail(email);
  let resolvedName: string | null = null;
  let mappedEmail: string | null = null;
  try {
    const mapping = loadEmailMapping();
    const entry = mapping.get(email) ?? mapping.get(canonicalEmail);
    resolvedName = entry?.name ?? null;
    mappedEmail = entry?.email?.toLowerCase?.() ?? null;
  } catch (error) {
    console.error('Email mapping load failed; falling back to database lookup', error);
  }
  const accountEmail = mappedEmail ?? email;
  const candidateEmailSet = new Set([email, canonicalEmail, accountEmail, canonicalizeEmail(accountEmail)]);
  const candidateEmailList = Array.from(candidateEmailSet);

  if (!resolvedName) {
    const playerByEmail = await prisma.player.findFirst({
      where: {
        OR: candidateEmailList.map((candidate) => ({
          email: { equals: candidate, mode: 'insensitive' }
        }))
      },
      select: { name: true }
    });
    resolvedName = playerByEmail?.name ?? null;
  }
  if (!resolvedName) {
    const userByEmail = await prisma.user.findFirst({
      where: {
        OR: candidateEmailList.map((candidate) => ({
          email: { equals: candidate, mode: 'insensitive' }
        }))
      },
      select: { name: true }
    });
    resolvedName = userByEmail?.name ?? null;
  }

  if (!resolvedName) {
    return NextResponse.json(
      { error: 'Email not recognized. Use your roster email or ask the commissioner to add/link it.' },
      { status: 404 }
    );
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);
  const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const subject = 'Century Cup login details';
  const text = `Hey ${resolvedName},

Your Century Cup account is ready.

Login: ${accountEmail}
Password: ${password}

Sign in: ${appUrl}/signin

You can request a new password anytime from ${appUrl}/signup.`;

  const html = `
    <div style="font-family:Arial, sans-serif; color:#241a1a;">
      <h2 style="margin:0 0 12px;">Century Cup login details</h2>
      <p>Hey ${resolvedName},</p>
      <p>Your Century Cup account is ready.</p>
      <p><strong>Login:</strong> ${accountEmail}<br/>
         <strong>Password:</strong> ${password}</p>
      <p><a href="${appUrl}/signin">Sign in here</a></p>
    </div>
  `;

  try {
    await sendResendEmail({ to: accountEmail, subject, html, text });
  } catch (error) {
    console.error('Request access email send failed', error);
    return NextResponse.json({ error: 'Email delivery failed. Please try again in a minute.' }, { status: 502 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: {
          OR: candidateEmailList.map((candidate) => ({
            email: { equals: candidate, mode: 'insensitive' }
          }))
        }
      });
      if (existingUser) {
        await tx.user.update({
          where: { id: existingUser.id },
          data: {
            email: accountEmail,
            passwordHash,
            name: resolvedName
          }
        });
      } else {
        await tx.user.create({
          data: {
            email: accountEmail,
            name: resolvedName,
            passwordHash,
            role: 'USER'
          }
        });
      }

      const player = await tx.player.findFirst({
        where: {
          OR: candidateEmailList.map((candidate) => ({
            email: { equals: candidate, mode: 'insensitive' }
          }))
        }
      });
      if (!player) {
        const byName = await tx.player.findFirst({ where: { name: resolvedName } });
        if (byName && !byName.email) {
          await tx.player.update({ where: { id: byName.id }, data: { email: accountEmail } });
        } else if (!byName) {
          await tx.player.create({
            data: {
              name: resolvedName,
              email: accountEmail
            }
          });
        }
      }
    });
  } catch (error) {
    console.error('Request access persistence failed', error);
    return NextResponse.json(
      { error: 'Account setup failed after email send. Request a new password and try again.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, redirectTo: `/signin?passwordSent=1&email=${encodeURIComponent(accountEmail)}` });
}
