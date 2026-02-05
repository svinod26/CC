'use client';

import { useRouter } from 'next/navigation';
import { PlayerLink } from '@/components/player-link';
import { Sparkline } from '@/components/sparkline';

type RosterPlayer = { id: string; name: string };

type TeamCardProps = {
  teamId: string;
  name: string;
  conference: string;
  season: string;
  wins: number;
  losses: number;
  margin: number;
  fg: string;
  clutch: number;
  pulled: number;
  weekly: number[];
  roster: RosterPlayer[];
};

export function TeamCard({
  teamId,
  name,
  conference,
  season,
  wins,
  losses,
  margin,
  fg,
  clutch,
  pulled,
  weekly,
  roster
}: TeamCardProps) {
  const router = useRouter();
  const onCardClick = () => router.push(`/teams/${teamId}`);

  return (
    <div
      className="cursor-pointer rounded-2xl border border-garnet-100 bg-white/85 p-5 shadow transition hover:bg-gold-50/40"
      role="button"
      tabIndex={0}
      onClick={onCardClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onCardClick();
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-lg font-semibold text-ink">{name}</p>
          <p className="text-xs text-ash">
            {conference} · {season}
          </p>
        </div>
        <div className="text-right text-xs uppercase text-ash">
          Record
          <div className="text-base font-semibold text-garnet-600">
            {wins}-{losses}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <TeamStat label="Margin" value={margin} />
        <TeamStat label="FG%" value={fg} />
        <TeamStat label="Clutch (tracked)" value={clutch} />
      </div>
      <p className="mt-2 text-xs text-ash">Pulled cups: {pulled}</p>

      <div className="mt-3">
        <p className="text-xs uppercase tracking-wide text-ash">Weekly trend</p>
        <div className="mt-1">
          <Sparkline data={weekly} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {roster.map((player) => (
          <span key={player.id} className="rounded-full bg-gold-50 px-2 py-0.5 text-xs text-ink">
            <span onClick={(event) => event.stopPropagation()}>
              <PlayerLink id={player.id} name={player.name} className="text-ink hover:text-garnet-600" />
            </span>
          </span>
        ))}
        {roster.length === 0 && <span className="text-xs text-ash">No roster loaded.</span>}
      </div>
    </div>
  );
}

function TeamStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-garnet-100 bg-parchment/70 px-3 py-2 text-sm">
      <p className="text-xs uppercase tracking-wide text-ash">{label}</p>
      <p className="text-lg font-semibold text-garnet-600">{value}</p>
    </div>
  );
}
