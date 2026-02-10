'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { registerUser } from '@/lib/actions/auth';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-garnet-600 px-5 py-3 text-base font-semibold text-sand shadow hover:bg-garnet-500 disabled:opacity-50"
    >
      {pending ? 'Creating…' : 'Create account'}
    </button>
  );
}

export function SignupForm() {
  const [state, action] = useFormState(registerUser, { error: '' });
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'loading' | 'found' | 'missing'>('idle');

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
        if (!res.ok) {
          setLookupStatus('missing');
          return;
        }
        const data = await res.json();
        if (data?.found && data?.name) {
          setName(data.name);
          setLookupStatus('found');
        } else {
          setLookupStatus('missing');
        }
      } catch {
        setLookupStatus('missing');
      }
    }, 350);
    return () => clearTimeout(timeout);
  }, [email]);

  return (
    <form action={action} className="space-y-4">
      {state?.error && <div className="rounded-xl bg-garnet-50 px-3 py-2 text-sm text-garnet-700">{state.error}</div>}
      <label className="block space-y-1 text-sm">
        <span className="text-ink">Email</span>
        <input
          name="email"
          className="w-full"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-ink">Name</span>
        <input
          name="name"
          className="w-full"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={lookupStatus === 'found' ? '' : 'League Manager'}
          readOnly={lookupStatus === 'found'}
          required={lookupStatus === 'missing'}
        />
        {lookupStatus === 'found' && <span className="text-xs text-ash">Matched from roster.</span>}
        {lookupStatus === 'missing' && <span className="text-xs text-ash">Not on roster yet, please enter your name.</span>}
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-ink">Password</span>
        <input name="password" className="w-full" type="password" required minLength={6} />
      </label>
      <SubmitButton />
    </form>
  );
}
