'use client';

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

  return (
    <form action={action} className="space-y-4">
      {state?.error && <div className="rounded-xl bg-garnet-50 px-3 py-2 text-sm text-garnet-700">{state.error}</div>}
      <label className="block space-y-1 text-sm">
        <span className="text-ink">Name</span>
        <input name="name" className="w-full" type="text" placeholder="League Manager" />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-ink">Email</span>
        <input name="email" className="w-full" type="email" required />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-ink">Password</span>
        <input name="password" className="w-full" type="password" required minLength={6} />
      </label>
      <SubmitButton />
    </form>
  );
}
