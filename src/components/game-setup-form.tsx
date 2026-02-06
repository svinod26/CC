'use client';

import { GameType, Team, TeamRoster, Player } from '@prisma/client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

type TeamWithRoster = Team & { rosters: (TeamRoster & { player: Player })[] };

export function GameSetupForm({
  teams,
  players,
  seasonId,
  maxWeek
}: {
  teams: TeamWithRoster[];
  players: Player[];
  seasonId?: string;
  maxWeek: number;
}) {
  const router = useRouter();
  const [gameType, setGameType] = useState<GameType>('LEAGUE');
  const [selectedSeasonId] = useState<string | undefined>(seasonId);
  const [homeTeamId, setHomeTeamId] = useState<string>('');
  const [awayTeamId, setAwayTeamId] = useState<string>('');
  const [homeTeamName, setHomeTeamName] = useState('');
  const [awayTeamName, setAwayTeamName] = useState('');
  const [week, setWeek] = useState<number>(maxWeek);
  const [homeLineup, setHomeLineup] = useState<string[]>(Array.from({ length: 6 }, () => ''));
  const [awayLineup, setAwayLineup] = useState<string[]>(Array.from({ length: 6 }, () => ''));
  const [homeLineupNames, setHomeLineupNames] = useState<string[]>(Array.from({ length: 6 }, () => ''));
  const [awayLineupNames, setAwayLineupNames] = useState<string[]>(Array.from({ length: 6 }, () => ''));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const rosterOptions = useMemo(() => {
    const homeRoster = teams.find((t) => t.id === homeTeamId)?.rosters ?? [];
    const awayRoster = teams.find((t) => t.id === awayTeamId)?.rosters ?? [];
    return {
      home: homeRoster.map((r) => r.player),
      away: awayRoster.map((r) => r.player)
    };
  }, [homeTeamId, awayTeamId, teams]);

  const playerLookup = useMemo(() => {
    const map = new Map<string, Player>();
    players.forEach((player) => map.set(player.name.toLowerCase(), player));
    return map;
  }, [players]);

  const inputClass = 'w-full rounded-xl border border-garnet-200 bg-white/80 px-3 py-2 text-sm text-ink shadow-sm';
  const selectClass = `${inputClass} appearance-none pr-10`;

  useEffect(() => {
    setHomeLineup(Array.from({ length: 6 }, () => ''));
    setAwayLineup(Array.from({ length: 6 }, () => ''));
    setHomeLineupNames(Array.from({ length: 6 }, () => ''));
    setAwayLineupNames(Array.from({ length: 6 }, () => ''));
    if (gameType === 'EXHIBITION') {
      setHomeTeamId('');
      setAwayTeamId('');
      setHomeTeamName('');
      setAwayTeamName('');
    }
  }, [gameType]);

  useEffect(() => {
    if (gameType === 'LEAGUE') {
      setHomeLineup(Array.from({ length: 6 }, () => ''));
      setAwayLineup(Array.from({ length: 6 }, () => ''));
    }
  }, [homeTeamId, awayTeamId, gameType]);

  useEffect(() => {
    setWeek(maxWeek);
  }, [maxWeek]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const isLeague = gameType === 'LEAGUE';
    const lineupIds = isLeague ? homeLineup : homeLineupNames.map((name) => playerLookup.get(name.toLowerCase())?.id ?? '');
    const awayIds = isLeague ? awayLineup : awayLineupNames.map((name) => playerLookup.get(name.toLowerCase())?.id ?? '');

    if (isLeague) {
      if (!homeTeamId || !awayTeamId) {
        setError('Select both teams.');
        return;
      }
      if (homeTeamId === awayTeamId) {
        setError('Home and away teams must differ.');
        return;
      }
    } else {
      const trimmedHome = homeTeamName.trim();
      const trimmedAway = awayTeamName.trim();
      if (!trimmedHome || !trimmedAway) {
        setError('Enter both exhibition team names.');
        return;
      }
      if (trimmedHome.toLowerCase() === trimmedAway.toLowerCase()) {
        setError('Home and away teams must differ.');
        return;
      }
    }

    if (lineupIds.some((id) => !id) || awayIds.some((id) => !id)) {
      setError('Set all six shooters for each side.');
      return;
    }

    if (new Set(lineupIds).size !== lineupIds.length || new Set(awayIds).size !== awayIds.length) {
      setError('Each lineup must have unique shooters.');
      return;
    }

    setLoading(true);
    const payload = {
      type: gameType,
      seasonId: selectedSeasonId || undefined,
      homeTeamId: isLeague ? homeTeamId : undefined,
      awayTeamId: isLeague ? awayTeamId : undefined,
      homeTeamName: !isLeague ? homeTeamName : undefined,
      awayTeamName: !isLeague ? awayTeamName : undefined,
      week: isLeague ? week : undefined,
      homeLineupIds: lineupIds,
      awayLineupIds: awayIds
    };

    const res = await fetch('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json();
      setError(body?.error ?? 'Failed to create game');
      return;
    }
    const data = await res.json();
    router.push(`/games/${data.id}`);
  };

  const homePlayers = rosterOptions.home ?? [];
  const awayPlayers = rosterOptions.away ?? [];

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-garnet-100 bg-white/90 p-4 shadow sm:space-y-5 sm:p-5">
      {error && <div className="rounded-xl bg-garnet-50 px-3 py-2 text-sm text-garnet-700">{error}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-ink">Game type</span>
          <div className="relative">
            <select
              className={selectClass}
              value={gameType}
              onChange={(e) => setGameType(e.target.value as GameType)}
            >
              <option value="LEAGUE">League</option>
              <option value="EXHIBITION">Exhibition</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" />
          </div>
        </label>
      </div>

      {gameType === 'LEAGUE' && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-ink">Home team</span>
            <div className="relative">
              <select className={selectClass} value={homeTeamId} onChange={(e) => setHomeTeamId(e.target.value)}>
                <option value="">Select team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" />
            </div>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-ink">Away team</span>
            <div className="relative">
              <select className={selectClass} value={awayTeamId} onChange={(e) => setAwayTeamId(e.target.value)}>
                <option value="">Select team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" />
            </div>
          </label>
        </div>
      )}

      {gameType === 'EXHIBITION' && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-ink">Home team name</span>
            <input
              className={inputClass}
              value={homeTeamName}
              onChange={(e) => setHomeTeamName(e.target.value)}
              placeholder="Home team"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-ink">Away team name</span>
            <input
              className={inputClass}
              value={awayTeamName}
              onChange={(e) => setAwayTeamName(e.target.value)}
              placeholder="Away team"
            />
          </label>
        </div>
      )}

      {gameType === 'LEAGUE' && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-ink">Week</span>
            <div className="relative">
              <select className={selectClass} value={week} onChange={(e) => setWeek(Number(e.target.value))}>
                {Array.from({ length: maxWeek }, (_, idx) => idx + 1).map((wk) => (
                  <option key={wk} value={wk}>
                    Week {wk}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" />
            </div>
          </label>
        </div>
      )}

      {gameType === 'LEAGUE' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <OrderedLineup
            title="Home order"
            players={homePlayers}
            selected={homeLineup}
            onChange={setHomeLineup}
          />
          <OrderedLineup
            title="Away order"
            players={awayPlayers}
            selected={awayLineup}
            onChange={setAwayLineup}
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <SearchLineup
            title="Home shooters"
            values={homeLineupNames}
            onChange={setHomeLineupNames}
            players={players}
          />
          <SearchLineup
            title="Away shooters"
            values={awayLineupNames}
            onChange={setAwayLineupNames}
            players={players}
          />
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-full bg-garnet-600 px-5 py-3 text-center text-base font-semibold text-sand shadow hover:bg-garnet-500 disabled:opacity-50"
      >
        {loading ? 'Creating…' : 'Create game'}
      </button>
    </form>
  );
}

function OrderedLineup({
  title,
  players,
  selected,
  onChange
}: {
  title: string;
  players: Player[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const updateSlot = (index: number, value: string) => {
    const next = [...selected];
    next[index] = value;
    onChange(next);
  };
  const selectClass =
    'mt-1 w-full appearance-none rounded-xl border border-garnet-200 bg-white/80 px-3 py-2 pr-10 text-sm text-ink shadow-sm';

  return (
    <div className="rounded-2xl border border-garnet-100 bg-white/70 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-xs text-ash">Set 1 - 6</p>
      </div>
      {players.length === 0 && <p className="text-xs text-ash">Select a team to load roster.</p>}
      <div className="mt-3 grid gap-3">
        {selected.map((value, idx) => {
          const taken = new Set(selected.filter((_, sidx) => sidx !== idx).filter(Boolean));
          const options = players.filter((player) => !taken.has(player.id) || player.id === value);
          return (
          <label key={`${title}-${idx}`} className="text-xs text-ash">
            Shooter {idx + 1}
            <div className="relative">
              <select
                className={selectClass}
                value={value}
                onChange={(e) => updateSlot(idx, e.target.value)}
              >
              <option value="">Select player</option>
              {options.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" />
            </div>
          </label>
        );
        })}
      </div>
    </div>
  );
}

function SearchLineup({
  title,
  values,
  onChange,
  players
}: {
  title: string;
  values: string[];
  onChange: (values: string[]) => void;
  players: Player[];
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const updateSlot = (index: number, value: string) => {
    const next = [...values];
    next[index] = value;
    onChange(next);
  };
  const inputClass =
    'mt-1 w-full rounded-xl border border-garnet-200 bg-white/80 px-3 py-2 text-sm text-ink shadow-sm';

  const normalizedSelected = values.map((value) => value.trim().toLowerCase());

  return (
    <div className="rounded-2xl border border-garnet-100 bg-white/70 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-xs text-ash">Search any player</p>
      </div>
      <div className="mt-3 grid gap-3">
        {values.map((value, idx) => {
          const query = value.trim().toLowerCase();
          const suggestions =
            query.length === 0
              ? []
              : players
                  .filter((player) => player.name.toLowerCase().includes(query))
                  .filter((player) => {
                    const normalized = player.name.toLowerCase();
                    return normalized === normalizedSelected[idx] || !normalizedSelected.includes(normalized);
                  })
                  .slice(0, 6);
          return (
            <div key={`${title}-${idx}`} className="relative">
              <label className="text-xs text-ash">
                Shooter {idx + 1}
                <input
                  className={inputClass}
                  value={value}
                  onFocus={() => setOpenIndex(idx)}
                  onBlur={() => setTimeout(() => setOpenIndex(null), 120)}
                  onChange={(e) => updateSlot(idx, e.target.value)}
                  placeholder="Start typing a name"
                />
              </label>
              {openIndex === idx && suggestions.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-xl border border-garnet-100 bg-white p-1 shadow-lg">
                  {suggestions.map((player) => (
                    <button
                      key={player.id}
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-gold-50"
                      onClick={() => {
                        updateSlot(idx, player.name);
                        setOpenIndex(null);
                      }}
                    >
                      {player.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
