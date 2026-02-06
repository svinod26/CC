'use client';

import { useState } from 'react';

export function RequestAccessForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus('loading');
    setMessage(null);
    const res = await fetch('/api/auth/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (res.ok) {
      setStatus('sent');
      setMessage('If your email is on the roster, a password has been sent.');
      return;
    }
    const body = await res.json().catch(() => ({}));
    setStatus('error');
    setMessage(body?.error ?? 'Unable to send a password right now.');
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
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
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
