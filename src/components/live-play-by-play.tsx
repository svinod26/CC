'use client';

import useSWR from 'swr';
import { PlayerLink } from '@/components/player-link';

type PlayEvent = {
  id: string;
  resultType: string;
  shooter: { id: string; name: string | null } | null;
  shooterId: string | null;
  remainingCupsBefore: number;
  remainingCupsAfter: number;
  timestamp: string | Date;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function LivePlayByPlay({
  gameId,
  initialEvents
}: {
  gameId: string;
  initialEvents: PlayEvent[];
}) {
  const { data } = useSWR<{ events: PlayEvent[] }>(`/api/games/${gameId}/state`, fetcher, {
    fallbackData: { events: initialEvents },
    refreshInterval: 5000
  });

  const events = (data?.events ?? initialEvents).slice().sort((a, b) => {
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    return bTime - aTime;
  });

  if (events.length === 0) {
    return <p className="text-ash text-sm">No events yet.</p>;
  }

  return (
    <div className="max-h-80 space-y-2 overflow-y-auto pr-2 text-sm">
      {events.map((event) => (
        <div
          key={event.id}
          className="flex items-center justify-between rounded border border-garnet-100 bg-white/80 px-3 py-2"
        >
          <div>
            <p className="font-semibold text-ink">
              {event.shooter ? (
                <PlayerLink
                  id={event.shooter.id}
                  name={event.shooter.name ?? '—'}
                  className="text-ink hover:text-garnet-600"
                />
              ) : (
                '—'
              )}{' '}
              · {event.resultType}
            </p>
            <p className="text-xs text-ash">
              Cups before: {event.remainingCupsBefore} → {event.remainingCupsAfter}
            </p>
          </div>
          <p className="text-xs text-ash">{new Date(event.timestamp).toLocaleTimeString()}</p>
        </div>
      ))}
    </div>
  );
}
