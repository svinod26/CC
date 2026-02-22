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

type Segment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
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
    .map((point, idx) => ({
      x: padX + idx * stepX,
      y: yFor(point.diff),
      diff: point.diff
    }));
  const neutralPath = linePath
    .map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');

  const homeColor = '#0f766e';
  const awayColor = '#b4233c';

  const segments: Segment[] = [];
  for (let i = 1; i < linePath.length; i += 1) {
    const prev = linePath[i - 1];
    const curr = linePath[i];
    const prevSign = Math.sign(prev.diff);
    const currSign = Math.sign(curr.diff);

    if (prevSign === currSign || prevSign === 0 || currSign === 0) {
      const sign = prevSign !== 0 ? prevSign : currSign;
      segments.push({
        x1: prev.x,
        y1: prev.y,
        x2: curr.x,
        y2: curr.y,
        color: sign >= 0 ? homeColor : awayColor
      });
      continue;
    }

    const t = (0 - prev.diff) / (curr.diff - prev.diff);
    const crossX = prev.x + (curr.x - prev.x) * t;
    const crossY = zeroY;

    segments.push({
      x1: prev.x,
      y1: prev.y,
      x2: crossX,
      y2: crossY,
      color: prevSign > 0 ? homeColor : awayColor
    });
    segments.push({
      x1: crossX,
      y1: crossY,
      x2: curr.x,
      y2: curr.y,
      color: currSign > 0 ? homeColor : awayColor
    });
  }

  const finalLabel =
    finalDiff === 0
      ? 'Tied'
      : finalDiff > 0
        ? `${homeTeamName} +${finalDiff}`
        : `${awayTeamName} +${Math.abs(finalDiff)}`;
  const finalColor = finalDiff === 0 ? 'text-ash' : finalDiff > 0 ? 'text-teal-700' : 'text-rose-700';

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
          <p className={`font-semibold ${finalColor}`}>{finalLabel}</p>
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
          <rect x={padX} y={padY} width={plotWidth} height={Math.max(0, zeroY - padY)} fill="#ecfdf5" />
          <rect x={padX} y={zeroY} width={plotWidth} height={Math.max(0, height - padY - zeroY)} fill="#fff1f2" />
          <line
            x1={padX}
            y1={zeroY}
            x2={width - padX}
            y2={zeroY}
            stroke="#c9b6b6"
            strokeDasharray="4 4"
            strokeWidth="1.5"
          />
          <path d={neutralPath} fill="none" stroke="#d8c7c7" strokeWidth="2" />
          {segments.map((segment, idx) => (
            <line
              key={`${segment.x1}-${segment.x2}-${idx}`}
              x1={segment.x1}
              y1={segment.y1}
              x2={segment.x2}
              y2={segment.y2}
              stroke={segment.color}
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          ))}
          <circle
            cx={padX + (points.length - 1) * stepX}
            cy={yFor(points[points.length - 1]?.diff ?? 0)}
            r="3.5"
            fill={finalDiff >= 0 ? homeColor : awayColor}
          />
        </svg>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-ash">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-teal-700" /> {homeTeamName} leading
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-700" /> {awayTeamName} leading
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-ash">
          <span>Start</span>
          <span>Latest scoring event</span>
        </div>
      </div>
    </section>
  );
}
