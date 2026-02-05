'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

export function GameTypeSelect({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', next);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <label className="space-y-1 text-xs uppercase tracking-wide text-ash">
      Game type
      <div className="relative text-sm normal-case text-ink">
        <select
          className="w-full appearance-none rounded-full border border-garnet-200 bg-white/80 px-4 py-2 pr-10 text-sm font-semibold text-ink shadow-sm"
          value={value}
          onChange={(event) => handleChange(event.target.value)}
        >
          <option value="all">All games</option>
          <option value="LEAGUE">League</option>
          <option value="EXHIBITION">Exhibition</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" />
      </div>
    </label>
  );
}
