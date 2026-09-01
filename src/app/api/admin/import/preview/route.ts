import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { AdminSeasonImportError, previewSeasonImport } from '@/lib/admin-season-import';
import {
  createManualSeasonImportDraft,
  parseSeasonWorkbook,
  seasonImportDraftSchema
} from '@/lib/excel';

const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;
const importMetadataSchema = z.object({
  seasonName: z.string().trim().min(1).max(50),
  year: z.coerce.number().int().min(2000).max(2100)
});

const looksLikeExcel = (bytes: Uint8Array) =>
  (bytes[0] === 0x50 && bytes[1] === 0x4b) ||
  (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0);

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let draft;
  let seedManualTeams = false;
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const json = await req.json().catch(() => null);
    const parsedDraft = seasonImportDraftSchema.safeParse(json?.draft);
    if (!parsedDraft.success) {
      return NextResponse.json({ error: 'The edited import data is invalid.' }, { status: 400 });
    }
    draft = parsedDraft.data;
  } else {
    const formData = await req.formData().catch(() => null);
    const metadata = importMetadataSchema.safeParse({
      seasonName: formData?.get('seasonName'),
      year: formData?.get('year')
    });
    if (!formData || !metadata.success) {
      return NextResponse.json({ error: 'Enter a valid season name and year.' }, { status: 400 });
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      draft = createManualSeasonImportDraft(metadata.data.seasonName, metadata.data.year);
      seedManualTeams = true;
    } else {
      if (file.size === 0) return NextResponse.json({ error: 'Choose a non-empty workbook.' }, { status: 400 });
      if (file.size > MAX_WORKBOOK_BYTES) return NextResponse.json({ error: 'Workbook must be 10 MB or smaller.' }, { status: 413 });
      if (!/\.(xlsx|xls)$/i.test(file.name)) return NextResponse.json({ error: 'Workbook must be an .xlsx or .xls file.' }, { status: 400 });

      const buffer = await file.arrayBuffer();
      if (!looksLikeExcel(new Uint8Array(buffer).subarray(0, 8))) {
        return NextResponse.json({ error: 'The uploaded file does not appear to be an Excel workbook.' }, { status: 400 });
      }
      try {
        draft = parseSeasonWorkbook(buffer, metadata.data.seasonName, metadata.data.year);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not read that workbook.';
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }
  }

  try {
    const plan = await previewSeasonImport(session.user.id, draft, { seedManualTeams });
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    if (error instanceof AdminSeasonImportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Season import preview failed', error);
    return NextResponse.json({ error: 'Unable to preview the season import. No data was changed.' }, { status: 500 });
  }
}
