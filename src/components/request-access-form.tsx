'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export function RequestAccessForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'loading' | 'found' | 'missing'>('idle');
  const [mappedName, setMappedName] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!email || !email.includes('@')) {
      setLookupStatus('idle');
      return;
    }

    const timeout = setTimeout(async () => {
      setLookupStatus('loading');
      try {
        const res = await fetch('/api/auth/lookup-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.found) {
          setMappedName(data?.name ?? '');
          setLookupStatus('found');
          return;
        }
        setMappedName('');
        setLookupStatus('missing');
      } catch {
        setMappedName('');
        setLookupStatus('missing');
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [email]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus('loading');
    setMessage(null);
    try {
      const res = await fetch('/api/auth/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus('sent');
        setMessage('Password sent. Redirecting to sign in…');
        const redirectTo =
          typeof body?.redirectTo === 'string' && body.redirectTo.length > 0
            ? body.redirectTo
            : `/signin?passwordSent=1&email=${encodeURIComponent(email.trim().toLowerCase())}`;
        setTimeout(() => router.push(redirectTo), 350);
        return;
      }

      const body = await res.json().catch(() => ({}));
      setStatus('error');
      setMessage(body?.error ?? 'Unable to send a password right now.');
    } catch {
      setStatus('error');
      setMessage('Network error. Please try again.');
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {message && (
        <div
          className={`rounded-xl px-3 py-2 text-sm ${
            status === 'sent'
              ? 'bg-emerald-50 text-emerald-700'
              : status === 'error'
                ? 'bg-rose-50 text-rose-700'
                : 'bg-gold-50 text-garnet-600'
          }`}
        >
          {message}
        </div>
      )}

      <label className="block space-y-1 text-sm">
        <span className="text-ink">Email</span>
        <input
          className="w-full"
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (status !== 'idle') {
              setStatus('idle');
              setMessage(null);
            }
          }}
          required
        />
      </label>

      {lookupStatus === 'found' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-700">
          Matched roster entry: <span className="font-semibold">{mappedName}</span>
        </div>
      )}

      {lookupStatus === 'missing' && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-700">
          Email not found in roster mapping. Use the exact email on file with the commissioner.
        </div>
      )}

      <button
        disabled={status === 'loading'}
        className="w-full rounded-full border border-garnet-200 bg-white/90 px-5 py-3 text-base font-semibold text-garnet-700 shadow hover:bg-gold-100 disabled:opacity-50"
        type="submit"
      >
        {status === 'loading' ? 'Sending…' : 'Email me a password'}
      </button>
    </form>
  );
}
