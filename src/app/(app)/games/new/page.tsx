import { prisma } from '@/lib/prisma';
import { GameSetupForm } from '@/components/game-setup-form';

export const metadata = {
  title: 'Start game | Century Cup'
};

export default async function NewGamePage() {
  const [teams, seasons, players] = await Promise.all([
    prisma.team.findMany({
      include: {
        rosters: {
          include: { player: true }
        }
      },
      orderBy: { name: 'asc' }
    }),
    prisma.season.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.player.findMany({ orderBy: { name: 'asc' } })
  ]);

  const now = new Date();
  const year = now.getFullYear();
  const isFall = now.getMonth() >= 6;
  const seasonName = isFall ? 'Fall' : 'Spring';
  const matchingSeason =
    seasons.find(
      (season) =>
        (season.year ?? year) === year &&
        season.name.toLowerCase().includes(seasonName.toLowerCase())
    ) ?? seasons[0];

  const mondayOnOrAfter = (date: Date) => {
    const result = new Date(date);
    const day = result.getDay();
    const delta = (8 - day) % 7;
    result.setDate(result.getDate() + delta);
    return result;
  };
  const springStart = mondayOnOrAfter(new Date(year, 0, 8));
  const fallStart = new Date(year, 7, 24);
  const seasonStart = isFall ? fallStart : springStart;
  const diffDays = Math.floor((now.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24));
  const currentWeek = Math.min(7, Math.max(1, Math.floor(diffDays / 7) + 1));

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-garnet-100 bg-white/85 p-5 shadow">
        <p className="text-xs uppercase tracking-[0.2em] text-garnet-600">Game setup</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">Start a new game</h1>
        <p className="mt-2 text-sm text-ash">
          Pick the matchup, set the shooting order, and you’re live in seconds.
        </p>
      </div>
      <GameSetupForm
        teams={teams}
        players={players}
        seasonId={matchingSeason?.id}
        maxWeek={currentWeek}
      />
    </div>
  );
}
