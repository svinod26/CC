import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { AccountIdentityConflictError, resolveAccountIdentity } from '@/lib/account-identity';
import { sendResendEmail } from '@/lib/resend';

const requestSchema = z.object({
  email: z.string().trim().email().max(254)
});

const generatePassword = () => randomBytes(9).toString('base64url');

class AccountIdentityChangedError extends Error {}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  if (!json || typeof json !== 'object') {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  let identity;
  try {
    identity = await resolveAccountIdentity(prisma, parsed.data.email);
  } catch (error) {
    if (error instanceof AccountIdentityConflictError) {
      return NextResponse.json(
        { error: 'This email matches multiple records. Ask the commissioner to correct the account records.' },
        { status: 409 }
      );
    }
    console.error('Request access identity lookup failed', error);
    return NextResponse.json({ error: 'Unable to check that email right now.' }, { status: 500 });
  }

  if (!identity.accountEmail || (!identity.player && !identity.user)) {
    return NextResponse.json(
      { error: 'Email not recognized. Use the email on your player record or ask the commissioner to add it.' },
      { status: 404 }
    );
  }

  const accountEmail = identity.accountEmail;
  const resolvedName = identity.player?.name ?? identity.user?.name ?? 'there';
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
      const currentIdentity = await resolveAccountIdentity(tx, parsed.data.email);
      if (
        currentIdentity.accountEmail !== accountEmail ||
        currentIdentity.player?.id !== identity.player?.id ||
        currentIdentity.user?.id !== identity.user?.id
      ) {
        throw new AccountIdentityChangedError();
      }

      if (currentIdentity.user) {
        await tx.user.update({
          where: { id: currentIdentity.user.id },
          data: {
            passwordHash,
            ...(currentIdentity.player
              ? { email: accountEmail, name: currentIdentity.player.name }
              : {})
          }
        });
      } else if (currentIdentity.player) {
        await tx.user.create({
          data: {
            email: accountEmail,
            name: currentIdentity.player.name,
            passwordHash,
            role: 'USER'
          }
        });
      }
    });
  } catch (error) {
    console.error('Request access persistence failed', error);
    if (error instanceof AccountIdentityChangedError || error instanceof AccountIdentityConflictError) {
      return NextResponse.json(
        { error: 'The account record changed while processing. Please request a new password again.' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Account setup failed after email send. Request a new password and try again.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, redirectTo: `/signin?passwordSent=1&email=${encodeURIComponent(accountEmail)}` });
}
