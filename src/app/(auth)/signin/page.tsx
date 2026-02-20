import Link from 'next/link';
import { SignInForm } from '@/components/signin-form';
import { RequestAccessForm } from '@/components/request-access-form';
import { getServerAuthSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Sign in | Century Cup'
};

export default async function SignInPage() {
  const session = await getServerAuthSession();
  if (session) {
    redirect('/');
  }
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="rounded-2xl border border-garnet-100 bg-white/85 p-6 shadow-lg">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-garnet-600">Welcome back</p>
          <h1 className="mt-2 text-3xl font-bold text-ink">Sign in</h1>
          <p className="text-sm text-ash">
            Need first-time access?{' '}
            <Link href="/signup" className="text-garnet-600 hover:text-garnet-500">
              Get a password
            </Link>
          </p>
        </div>
        <SignInForm />
      </div>

      <div className="rounded-2xl border border-garnet-100 bg-white/85 p-6 shadow-lg">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-garnet-600">Need access?</p>
          <h2 className="mt-2 text-2xl font-bold text-ink">Email me a password</h2>
          <p className="text-sm text-ash">
            Enter the exact email from the roster mapping and we’ll send a login password.
          </p>
        </div>
        <div className="mt-4">
          <RequestAccessForm />
        </div>
      </div>
    </div>
  );
}
