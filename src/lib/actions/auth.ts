'use server';

import bcrypt from 'bcryptjs';
import { prisma } from '../prisma';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { loadEmailMapping } from '@/lib/email-mapping';

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).optional()
});

export async function registerUser(prevState: { error: string }, formData: FormData) {
  const data = Object.fromEntries(formData.entries());
  const parsed = signupSchema.safeParse({
    email: String(data.email ?? '').toLowerCase(),
    password: data.password,
    name: data.name
  });

  if (!parsed.success) {
    return { error: 'Invalid input' };
  }

  const mapping = loadEmailMapping();
  const mapped = mapping.get(parsed.data.email);
  const resolvedName = mapped?.name ?? parsed.data.name;
  if (!resolvedName) {
    return { error: 'Name is required for unlisted emails' };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return { error: 'User already exists' };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: resolvedName,
      passwordHash,
      role: 'USER'
    }
  });

  const playerByEmail = await prisma.player.findFirst({ where: { email: parsed.data.email } });
  if (!playerByEmail) {
    const playerByName = await prisma.player.findFirst({ where: { name: resolvedName } });
    if (playerByName && !playerByName.email) {
      await prisma.player.update({ where: { id: playerByName.id }, data: { email: parsed.data.email } });
    } else if (!playerByName) {
      await prisma.player.create({
        data: {
          name: resolvedName,
          email: parsed.data.email
        }
      });
    }
  }

  redirect('/signin?created=1');
}
