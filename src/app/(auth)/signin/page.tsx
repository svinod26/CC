import Link from 'next/link';
import { SignInForm } from '@/components/signin-form';

export const metadata = {
  title: 'Sign in | Century Cup'
};

export default function SignInPage() {
  return (
    <div className="mx-auto max-w-md space-y-6 rounded-2xl border border-garnet-100 bg-white/85 p-6 shadow-lg">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-garnet-600">Welcome back</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">Sign in</h1>
        <p className="text-sm text-ash">
          No account?{' '}
          <Link href="/signup" className="text-garnet-600 hover:text-garnet-500">
            Create one
          </Link>
        </p>
      </div>
      <SignInForm />
    </div>
  );
}
