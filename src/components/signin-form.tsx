'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function SignInForm() {
  const search = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const created = search.get('created');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn('credentials', { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError('Invalid email or password');
    } else {
      window.location.href = '/';
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {created && <div className="rounded-xl bg-gold-50 px-3 py-2 text-sm text-garnet-600">Account created.</div>}
      {error && <div className="rounded-xl bg-garnet-50 px-3 py-2 text-sm text-garnet-700">{error}</div>}
      <label className="block space-y-1 text-sm">
        <span className="text-ink">Email</span>
        <input
          className="w-full"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-ink">Password</span>
        <input
          className="w-full"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <button
        disabled={loading}
        className="w-full rounded-full bg-garnet-600 px-5 py-3 text-base font-semibold text-sand shadow hover:bg-garnet-500 disabled:opacity-50"
        type="submit"
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
