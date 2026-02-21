import { prisma } from '@/lib/prisma';
import { resolveSeasonSelection } from '@/lib/season';
import { SeasonSelect } from '@/components/season-select';
import { winnerFromGameState } from '@/lib/stats';

export const metadata = {
  title: 'League | Century Cup'
};

export default async function LeaguePage({
  searchParams
}: {
  searchParams?: { season?: string };
}) {
  const seasons = await prisma.season.findMany({ orderBy: { year: 'desc' } });
  const seasonParam = searchParams?.season === 'all' ? undefined : searchParams?.season;
  const { season, value: seasonValue, seasons: orderedSeasons } = resolveSeasonSelection(seasons, seasonParam);

  const seasonWithData = season
    ? await prisma.season.findUnique({
        where: { id: season.id },
        include: {
          teams: { include: { conference: true } },
          games: { include: { homeTeam: true, awayTeam: true, state: true } },
          conferences: true
        }
      })
    : null;

  if (!seasonWithData) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-ink">League</h1>
        <p className="text-ash">No season yet. Import or create one.</p>
      </div>
    );
  }

  const standings = new Map<
    string,
    { teamName: string; conference?: string; wins: number; losses: number; games: number }
  >();

  for (const team of seasonWithData.teams) {
    standings.set(team.id, {
      teamName: team.name,
      conference: team.conference?.name,
      wins: 0,
      losses: 0,
      games: 0
    });
  }

  for (const game of seasonWithData.games) {
    if (game.status !== 'FINAL' || !game.state || !game.homeTeamId || !game.awayTeamId) continue;
    const home = standings.get(game.homeTeamId);
    const away = standings.get(game.awayTeamId);
    if (!home || !away) continue;
    home.games += 1;
    away.games += 1;
    const homeRemaining = game.state.homeCupsRemaining;
    const awayRemaining = game.state.awayCupsRemaining;
    const winner = winnerFromGameState(game.state, {
      statsSource: game.statsSource,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId
    });
    if (winner === 'home') {
      home.wins += 1;
      away.losses += 1;
    } else if (winner === 'away') {
      away.wins += 1;
      home.losses += 1;
    }
  }

  const byConference: Record<string, typeof standings extends Map<any, infer V> ? V[] : any> = {};
  standings.forEach((value) => {
    const conf = value.conference;
    if (!conf) return;
    if (!byConference[conf]) byConference[conf] = [];
    byConference[conf].push(value);
  });

  Object.values(byConference).forEach((list) =>
    list.sort((a, b) => {
      if (b.wins === a.wins) return a.losses - b.losses;
      return b.wins - a.wins;
    })
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-garnet-600">{seasonWithData.name}</p>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Standings</h1>
          <p className="hidden text-[11px] text-ash sm:block sm:text-sm">
            Top 2 teams per conference advance to playoffs.
          </p>
        </div>
        <SeasonSelect seasons={orderedSeasons} value={seasonValue} allowAll={false} showLabel={false} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {Object.entries(byConference).map(([conf, rows]) => (
          <div key={conf} className="rounded-xl border border-garnet-100 bg-white/80 p-3 shadow sm:p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-base font-semibold text-garnet-600 sm:text-lg">{conf}</p>
              <p className="text-xs uppercase text-ash">W-L</p>
            </div>
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div key={row.teamName} className="flex items-center justify-between text-sm">
                  <span className="text-ink">
                    {idx + 1}. {row.teamName}
                  </span>
                  <span className="text-garnet-600">
                    {row.wins}-{row.losses}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
