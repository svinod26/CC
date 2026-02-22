import Link from 'next/link';
import { getServerAuthSession } from '@/lib/auth';
import { SignOutButton } from './sign-out-button';
import { MobileNav } from './mobile-nav';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/games', label: 'Games' },
  { href: '/teams', label: 'Team Hub' },
  { href: '/players/hub', label: 'Player Hub' },
  { href: '/players/compare', label: 'Compare' },
  { href: '/league', label: 'League' },
  { href: '/info', label: 'Info' }
];

export async function Header() {
  const session = await getServerAuthSession();
  const isAuthed = Boolean(session?.user);
  const isAdmin = session?.user?.role === 'ADMIN';
  const navLinks = isAdmin ? [...links, { href: '/admin', label: 'Admin' }] : links;
  const mobileLinks = [{ href: '/', label: 'Hub' }, ...navLinks];

  return (
    <header className="border-b border-garnet-100 bg-white/95">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 text-ink">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="hidden sm:inline-flex items-center gap-2 rounded-full bg-garnet-600 px-4 py-2 text-sm font-semibold text-sand shadow ring-1 ring-gold-300/70"
          >
            Century Cup
          </Link>
          <MobileNav links={mobileLinks} />
          <nav className="hidden gap-3 text-sm text-ash sm:flex">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-garnet-600">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-ash">
          {isAuthed ? (
            <>
              <span className="hidden sm:inline text-ash">
                {session?.user?.email} · {session?.user?.role ?? 'user'}
              </span>
              <SignOutButton />
            </>
          ) : (
            <Link
              href="/signin"
              className="rounded-full border border-garnet-200 px-4 py-2 text-sm font-semibold text-garnet-600 hover:bg-gold-100 hover:text-ink"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
