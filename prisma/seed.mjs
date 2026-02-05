import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@centurycup.test';
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'changeme';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('Admin already exists');
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: 'ADMIN',
      name: 'Commissioner'
    }
  });
  console.log('Created admin', email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
