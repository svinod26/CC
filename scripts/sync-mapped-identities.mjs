import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';

const prisma = new PrismaClient();
const MAPPING_FILE = 'Name_email_mapping.xlsx';

const normalize = (value) =>
  String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .trim();

const normalizeEmail = (value) => normalize(value).toLowerCase();

async function main() {
  const workbook = XLSX.readFile(MAPPING_FILE);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  let userUpdates = 0;
  let playerUpdates = 0;
  let emailLinks = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const [nameRaw, , emailRaw] = rows[i];
    const name = normalize(nameRaw);
    const email = normalizeEmail(emailRaw);
    if (!name || !email) continue;

    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.name !== name) {
      await prisma.user.update({ where: { id: user.id }, data: { name } });
      userUpdates += 1;
    }

    const playerByEmail = await prisma.player.findFirst({ where: { email } });
    if (playerByEmail) {
      if (playerByEmail.name !== name) {
        await prisma.player.update({ where: { id: playerByEmail.id }, data: { name } });
        playerUpdates += 1;
      }
      continue;
    }

    const playerByName = await prisma.player.findFirst({ where: { name } });
    if (playerByName && !playerByName.email) {
      await prisma.player.update({ where: { id: playerByName.id }, data: { email } });
      emailLinks += 1;
    }
  }

  console.log(`Updated users: ${userUpdates}`);
  console.log(`Updated players: ${playerUpdates}`);
  console.log(`Linked player emails: ${emailLinks}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
