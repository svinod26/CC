'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

type NavLink = { href: string; label: string };

export function MobileNav({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  const handleNav = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div ref={containerRef} className="relative sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-2 rounded-full bg-garnet-600 px-3 py-2 text-xs font-semibold text-sand shadow ring-1 ring-gold-300/70"
      >
        Century Cup
        <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 z-[70] mt-3 w-64 max-w-[85vw] max-h-[60vh] overflow-y-auto rounded-2xl border border-garnet-100 bg-white p-3 shadow-xl">
          <div className="flex items-center justify-between px-2 pb-2">
            <p className="text-[10px] uppercase tracking-wide text-ash">Menu</p>
          </div>
          <nav className="grid gap-1 text-sm text-ash">
            {links.map((link) => (
              <button
                key={link.href}
                type="button"
                onClick={() => handleNav(link.href)}
                className={`rounded-lg px-3 py-2 text-left font-semibold transition ${
                  pathname === link.href
                    ? 'bg-gold-50 text-garnet-700'
                    : 'text-ink hover:bg-gold-50 hover:text-garnet-600'
                }`}
              >
                {link.label}
              </button>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
