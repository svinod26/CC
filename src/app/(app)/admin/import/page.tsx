import { getServerAuthSession } from '@/lib/auth';
import { ImportForm } from '@/components/import-form';

export const metadata = {
  title: 'Import | Century Cup'
};

export default async function ImportPage() {
  const session = await getServerAuthSession();
  const isAdmin = session?.user?.role === 'ADMIN';

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-garnet-100 bg-white/85 p-6 text-ink shadow">
        <h1 className="text-3xl font-bold text-ink">Import data</h1>
        <p>You need admin role to import Excel.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-garnet-600">Data</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">Create League season</h1>
        <p className="mt-2 text-sm text-ash">
          Upload the standard Century Cup Excel sheet (xlsx) or enter the complete season manually, then validate every
          roster input CAREFULLY before creating anything.
        </p>
      </div>
      <ImportForm />
    </div>
  );
}
