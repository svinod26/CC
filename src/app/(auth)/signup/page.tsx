import Link from 'next/link';
import { SignupForm } from '@/components/signup-form';

export const metadata = {
  title: 'Sign up | Century Cup'
};

export default function SignUpPage() {
  return (
    <div className="mx-auto max-w-md space-y-6 rounded-2xl border border-garnet-100 bg-white/85 p-6 shadow-lg">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-garnet-600">Join the stat crew</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">Create account</h1>
        <p className="text-sm text-ash">
          Already have an account?{' '}
          <Link href="/signin" className="text-garnet-600 hover:text-garnet-500">
            Sign in
          </Link>
        </p>
      </div>
      <SignupForm />
    </div>
  );
}
