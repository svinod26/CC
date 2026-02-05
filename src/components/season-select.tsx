'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

type SeasonOption = { id: string; name: string };

export function SeasonSelect({
  seasons,
  value,
  allowAll = true,
  label = 'Season'
}: {
  seasons: SeasonOption[];
  value: string;
  allowAll?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('season', next);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <label className="space-y-1 text-xs uppercase tracking-wide text-ash">
      {label}
      <div className="relative text-sm normal-case text-ink">
        <select
          className="w-full appearance-none rounded-full border border-garnet-200 bg-white/80 px-4 py-2 pr-10 text-sm font-semibold text-ink shadow-sm"
          value={value}
          onChange={(event) => handleChange(event.target.value)}
        >
          {allowAll && (
            <option value="all" className="text-sm">
              All seasons
            </option>
          )}
          {seasons.map((season) => (
            <option key={season.id} value={season.name} className="text-sm">
              {season.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" />
      </div>
    </label>
  );
}
