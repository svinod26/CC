'use server';

import bcrypt from 'bcryptjs';
import { prisma } from '../prisma';
import { z } from 'zod';
import { redirect } from 'next/navigation';

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).optional(),
  role: z.enum(['ADMIN', 'USER']).optional()
});

export async function registerUser(prevState: { error?: string } | undefined, formData: FormData) {
  const data = Object.fromEntries(formData.entries());
  const parsed = signupSchema.safeParse({
    email: data.email,
    password: data.password,
    name: data.name,
    role: data.role
  });

  if (!parsed.success) {
    return { error: 'Invalid input' };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return { error: 'User already exists' };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash,
      role: parsed.data.role ?? 'USER'
    }
  });

  redirect('/signin?created=1');
}
