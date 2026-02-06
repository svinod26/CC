'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

export function GameTypeSelect({ value, showLabel = true }: { value: string; showLabel?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', next);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <label
      className={`flex flex-col text-[10px] uppercase leading-none tracking-wide text-ash sm:text-xs ${
        showLabel ? 'gap-1' : 'gap-0'
      }`}
    >
      {showLabel ? <span>Game type</span> : <span className="sr-only">Game type</span>}
      <div className="relative text-xs normal-case text-ink sm:text-sm">
        <select
          className="w-full max-w-[120px] appearance-none rounded-full border border-garnet-200 bg-white/80 px-2 py-0.5 pr-6 text-[11px] font-semibold text-ink shadow-sm sm:max-w-none sm:px-4 sm:py-2 sm:pr-10 sm:text-sm"
          value={value}
          onChange={(event) => handleChange(event.target.value)}
        >
          <option value="all">All games</option>
          <option value="LEAGUE">League</option>
          <option value="EXHIBITION">Exhibition</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" />
      </div>
    </label>
  );
}
