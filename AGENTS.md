# AGENTS.md

## Production database safety

The local `.env` points `DATABASE_URL` at the live production Postgres database. Treat every Prisma call and locally tested app action as production access.

- Do not create, update, delete, seed, import, migrate, or invoke a write-capable API/UI flow without explicit user approval for that exact production change.
- Do not run `prisma migrate dev/deploy`, `prisma db seed`, historical/sync import scripts, or `scripts/test-game-flow.mjs` without that approval; they write data.
- Prefer pure tests and read-only queries. Before an approved write, identify the exact rows and invariants; use a narrow transaction and verify the result afterward.

## Project and commands

Century Cup is a mobile-first 100-cup pong league tracker built with Next.js 16 App Router, TypeScript, React, Tailwind, Prisma/Postgres, NextAuth credentials, SWR, and XLSX. Main areas are `src/app/(auth)`, `src/app/(app)`, `src/app/api`, `src/components`, and `src/lib`.

- `npm run dev` — local server at `http://localhost:3000`
- `npm test` — pure Node test suite; does not write to the database
- `npm run check` — TypeScript check
- `npm run lint` — ESLint
- `npm run build` — Prisma client generation plus Next.js production build

## Core architecture: event-sourced games

`docs/game-definitions.md` is the canonical spec for game-state semantics — read it before touching game logic, and keep it updated.

- For `TRACKED` games, the `ShotEvent` log is the source of truth. `GameState` (cups remaining, possession, shooter index, phase, status) is a derived cache. `recomputeGameState()` in `src/lib/game-state.ts` rebuilds it from the event log inside a transaction — undo and admin corrections work by editing events and then recomputing, never by mutating `GameState` directly. Admin corrections to finished games pass `preserveFinalStatus` so the game stays `FINAL`.
- Cup arithmetic: both teams start at 100, clamped 0–100. Makes by the offense reduce the *opponent's* cups. Make types are `TOP_REGULAR`, `TOP_ISO`, `BOTTOM_REGULAR`, `BOTTOM_ISO`; `PULL_HOME`/`PULL_AWAY` adjust a specific side's rack by `cupsDelta` (negative delta adds cups) and are not shots.
- Turn flow: a `Turn` row per rack with `shootersJson` (the 1–6 shooting order). Turns are 6 shots; 2+ makes earns a bonus turn for the same offense, otherwise possession flips. Phases: `REGULATION` → `REDEMPTION` (defense shoots until a miss once a team hits 0; the redemption shooter index advances on misses, not shots) → `OVERTIME`. An overtime game tied 0–0 stores the winner in `GameState.possessionTeamId`.
- Live console (`src/components/live-console.tsx`) drives everything through `/api/games/[id]/events`, `/undo`, `/advance`, `/finalize`, `/state`.

## LEGACY vs TRACKED stats

`LEGACY` games are historical imports whose source of truth is aggregate rows (`LegacyPlayerStat`/`LegacyTeamStat`), and their `homeCupsRemaining`/`awayCupsRemaining` fields have *inverted* winner semantics versus tracked games. Never compare remaining cups directly — always use `winnerFromRemaining`/`winnerFromGameState` from `src/lib/stats.ts`, which handle both sources. Imports must never overwrite a tracked game that occupies the same schedule slot.

Historical import scripts stored their execution time in `Game.startedAt`, not the real played date. General game lists sort chronologically, but an all-seasons player log must use canonical season order and then descending schedule week (`src/lib/player-game-order.ts`). Do not infer historical dates from `startedAt`.

## Other conventions

- **Stats formulas** live only in `src/lib/stats.ts`: `boxScore`, `baseRatingStats` (base weights), `advancedStats` (tempo rating with temporal scaling on cups remaining), `defaultMultipliers`. Pages should compute ratings through these, not reimplement weights.
- **Auth and identity**: NextAuth credentials use JWT sessions. Postgres `Player`/`User` records are the runtime source of truth for email access; signup does not read `Name_email_mapping.xlsx`. `PlayerAlias` resolves import nicknames. The XLSX mapping remains only for legacy scripts/reference.
- **Authorization**: `role` (`ADMIN`/`USER`) is attached in `src/lib/auth.ts`. Only a game's `statTaker` may post events; admin routes require `ADMIN` and should record material changes in `AdminAuditLog`.
- **Seasons** are named `F<year>`/`S<year>` (e.g. `S2026`). `src/lib/season.ts` owns sorting and resolving the selected season from the `?season=` URL param (defaults to the current term, `all` supported).
- **Rosters** preserve historical `TeamRoster` rows. `isActive` marks the player's current team for that season, and a partial unique index permits at most one active team per player/season. Trades and unassignments toggle active memberships; never delete or retarget historical memberships.
- **Season import** is League-only and uses the admin preview/review/confirm flow at `/admin/import`. It creates a new season, teams, active rosters, schedule, and optional aliases in one serializable transaction; it must resolve existing Players and must not create or update Player/User identities.
- **Weekly recap** (`src/lib/ai.ts`) uses `GEMINI_API_KEY` and falls back to a templated recap when unset.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
