'use client';

import { signOut } from 'next-auth/react';

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/' })}
      className="rounded-full bg-garnet-600 px-4 py-2 text-xs font-semibold text-sand shadow hover:bg-garnet-500 sm:text-sm"
    >
      Sign out
    </button>
  );
}
