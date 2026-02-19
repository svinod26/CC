import Link from 'next/link';
import { RequestAccessForm } from '@/components/request-access-form';
import { getServerAuthSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Get Access | Century Cup'
};

export default async function SignUpPage() {
  const session = await getServerAuthSession();
  if (session) {
    redirect('/');
  }

  return (
    <div className="mx-auto max-w-md space-y-6 rounded-2xl border border-garnet-100 bg-white/85 p-6 shadow-lg">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-garnet-600">Get started</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">Get your login password</h1>
        <p className="mt-2 text-sm text-ash">
          Enter your email. If it matches the roster, we send a password immediately. If it does not, add your name and we still create access.
        </p>
        <p className="text-sm text-ash">
          Already have an account?{' '}
          <Link href="/signin" className="text-garnet-600 hover:text-garnet-500">
            Sign in
          </Link>
        </p>
      </div>
      <RequestAccessForm />
    </div>
  );
}
