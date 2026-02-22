'use client';

import useSWR from 'swr';

type FlowEvent = {
  id: string;
  resultType: string;
  offenseTeamId: string | null;
  cupsDelta: number;
  timestamp: string | Date;
};

type Point = {
  index: number;
  diff: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const buildSeries = (
  events: FlowEvent[],
  homeTeamId: string,
  awayTeamId: string
) => {
  const sorted = events
    .slice()
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime() ||
        a.id.localeCompare(b.id)
    );

  let diff = 0;
  let scoringIndex = 0;
  let homeLeadMax = 0;
  let awayLeadMax = 0;
  const points: Point[] = [{ index: 0, diff: 0 }];

  for (const event of sorted) {
    if (!event.cupsDelta) continue;

    let delta = 0;
    if (event.resultType === 'PULL_HOME') {
      delta = -event.cupsDelta;
    } else if (event.resultType === 'PULL_AWAY') {
      delta = event.cupsDelta;
    } else if (event.offenseTeamId === homeTeamId) {
      delta = event.cupsDelta;
    } else if (event.offenseTeamId === awayTeamId) {
      delta = -event.cupsDelta;
    }

    if (!delta) continue;
    diff += delta;
    scoringIndex += 1;
    points.push({ index: scoringIndex, diff });
    if (diff > homeLeadMax) homeLeadMax = diff;
    if (diff < awayLeadMax) awayLeadMax = diff;
  }

  return {
    points,
    finalDiff: diff,
    homeLeadMax,
    awayLeadMax: Math.abs(awayLeadMax)
  };
};

export function GameFlowChart({
  gameId,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
  initialEvents,
  isLive
}: {
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  initialEvents: FlowEvent[];
  isLive: boolean;
}) {
  const { data } = useSWR<{ events: FlowEvent[] }>(
    `/api/games/${gameId}/state`,
    fetcher,
    {
      fallbackData: { events: initialEvents },
      refreshInterval: isLive ? 1200 : 0
    }
  );
  const events = data?.events ?? initialEvents;
  const { points, finalDiff, homeLeadMax, awayLeadMax } = buildSeries(
    events,
    homeTeamId,
    awayTeamId
  );

  if (points.length <= 1) {
    return (
      <section className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
        <h2 className="text-base font-semibold text-ink sm:text-lg">Game flow chart</h2>
        <p className="mt-2 text-sm text-ash">
          No scoring events yet.
        </p>
      </section>
    );
  }

  const width = 760;
  const height = 240;
  const padX = 18;
  const padY = 16;
  const plotWidth = width - padX * 2;
  const plotHeight = height - padY * 2;
  const leadExtent = Math.max(1, ...points.map((point) => Math.abs(point.diff)));
  const stepX = plotWidth / Math.max(points.length - 1, 1);
  const yFor = (value: number) => padY + ((leadExtent - value) / (leadExtent * 2)) * plotHeight;
  const zeroY = yFor(0);

  const linePath = points
    .map((point, idx) => {
      const x = padX + idx * stepX;
      const y = yFor(point.diff);
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  const areaPath = [
    linePath,
    `L ${(padX + (points.length - 1) * stepX).toFixed(2)} ${zeroY.toFixed(2)}`,
    `L ${padX.toFixed(2)} ${zeroY.toFixed(2)}`,
    'Z'
  ].join(' ');

  const finalLabel =
    finalDiff === 0
      ? 'Tied'
      : finalDiff > 0
        ? `${homeTeamName} +${finalDiff}`
        : `${awayTeamName} +${Math.abs(finalDiff)}`;

  return (
    <section className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink sm:text-lg">Game flow chart</h2>
          <p className="text-xs text-ash">
            Home lead over scoring events.
          </p>
        </div>
        <div className="text-right text-xs text-ash">
          <p className="font-semibold text-garnet-700">{finalLabel}</p>
          <p>
            Max leads: {homeTeamName} +{homeLeadMax} · {awayTeamName} +{awayLeadMax}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-garnet-100 bg-parchment/70 p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[210px] w-full"
          role="img"
          aria-label={`Game flow chart for ${homeTeamName} versus ${awayTeamName}`}
        >
          <defs>
            <linearGradient id={`flow-grad-${gameId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#991B2B" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#991B2B" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          <line
            x1={padX}
            y1={zeroY}
            x2={width - padX}
            y2={zeroY}
            stroke="#c9b6b6"
            strokeDasharray="4 4"
            strokeWidth="1.5"
          />
          <path d={areaPath} fill={`url(#flow-grad-${gameId})`} />
          <path d={linePath} fill="none" stroke="#7b2d2d" strokeWidth="3" strokeLinecap="round" />
          <circle
            cx={padX + (points.length - 1) * stepX}
            cy={yFor(points[points.length - 1]?.diff ?? 0)}
            r="3.5"
            fill="#7b2d2d"
          />
        </svg>
        <div className="mt-1 flex items-center justify-between text-[11px] text-ash">
          <span>Start</span>
          <span>Latest scoring event</span>
        </div>
      </div>
    </section>
  );
}
