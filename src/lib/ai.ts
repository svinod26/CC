import { StatsSource } from '@prisma/client';
import { winnerFromGameState } from '@/lib/stats';

type WeeklyGame = {
  id: string;
  statsSource: StatsSource;
  homeTeam: { id: string; name: string } | null;
  awayTeam: { id: string; name: string } | null;
  state: {
    homeCupsRemaining: number;
    awayCupsRemaining: number;
    phase?: string | null;
    status?: string | null;
    possessionTeamId?: string | null;
  } | null;
};

type TopPerformer = {
  name: string;
  makes: number;
  fg: number;
  tops: number;
};

type RecapInput = {
  week: number | null;
  games: WeeklyGame[];
  topPerformers: TopPerformer[];
};

const defaultRecap = (input: RecapInput) => {
  if (!input.week) return 'No completed games yet for this season.';
  const top = input.topPerformers[0];
  const topLine = top
    ? `${top.name} led the week with ${top.makes} cups on ${(top.fg * 100).toFixed(1)}% FG.`
    : 'No stat lines posted yet.';
  const gameLines = input.games
    .map((game) => {
      const home = game.homeTeam?.name ?? 'Home';
      const away = game.awayTeam?.name ?? 'Away';
      const winnerKey = winnerFromGameState(game.state, {
        statsSource: game.statsSource,
        homeTeamId: game.homeTeam?.id,
        awayTeamId: game.awayTeam?.id
      });
      const winner = winnerKey === 'home' ? home : winnerKey === 'away' ? away : 'Tie';
      return `${home} vs ${away} (winner: ${winner}).`;
    })
    .slice(0, 3)
    .join(' ');
  return `Week ${input.week} recap: ${topLine} ${gameLines}`.trim();
};

export async function getWeeklyRecap(input: RecapInput) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { text: defaultRecap(input), source: 'fallback' as const, reason: 'missing-key' as const };
  }

  const weekLabel = input.week ? `Week ${input.week}` : 'Latest week';
  const gameLines = input.games.map((game) => {
    const home = game.homeTeam?.name ?? 'Home';
    const away = game.awayTeam?.name ?? 'Away';
    const homeRemaining = game.state?.homeCupsRemaining ?? 0;
    const awayRemaining = game.state?.awayCupsRemaining ?? 0;
    const winnerKey = winnerFromGameState(game.state, {
      statsSource: game.statsSource,
      homeTeamId: game.homeTeam?.id,
      awayTeamId: game.awayTeam?.id
    });
    const winner = winnerKey === 'home' ? home : winnerKey === 'away' ? away : 'Tie';
    return `${home} vs ${away} (winner: ${winner}, remaining ${homeRemaining}-${awayRemaining}, ${game.statsSource.toLowerCase()})`;
  });
  const topLines = input.topPerformers.map((player) =>
    `${player.name}: ${player.makes} cups, ${(player.fg * 100).toFixed(1)}% FG, ${player.tops} tops`
  );

  const prompt = `You are writing a short league recap for a fraternity Century Cup pong league. Keep it to 2-3 sentences, confident and energetic. Mention the top performer and 1-2 game results. Use the data below, do not invent stats.

Week: ${weekLabel}
Games: ${gameLines.join(' | ') || 'No game data'}
Top performers: ${topLines.join(' | ') || 'No top performers'}
`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 120 }
        })
      }
    );

    if (!response.ok) {
      return { text: defaultRecap(input), source: 'fallback' as const, reason: 'gemini-error' as const };
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      return { text: defaultRecap(input), source: 'fallback' as const, reason: 'gemini-error' as const };
    }

    return { text, source: 'gemini' as const, reason: 'ok' as const };
  } catch (error) {
    return { text: defaultRecap(input), source: 'fallback' as const, reason: 'gemini-error' as const };
  }
}
