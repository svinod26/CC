# Century Cup (CC) League Tracker

Mobile-first Next.js app for running and stat-tracking the Century Cup stacked 100-cup pong league. Includes auth, Excel import, live game console, and postgame stats.

## Stack
- Next.js (App Router, TypeScript)
- Tailwind CSS
- Prisma + Postgres
- NextAuth (credentials)
- XLSX for Excel ingest

## Setup
```bash
npm install
cp .env.example .env
npx prisma migrate dev --name init
npx prisma db seed
npm run dev
```
Visit `http://localhost:3000`.

## Auth
- Sign in at `/signin` with your account.
- A default admin is seeded from `.env` (`DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD`).
- Admins can import Excel and manage seasons; users can start/exhibit games and log stats.

## Email access (Resend)
This app can email temporary passwords based on `Name_email_mapping.xlsx`.

1. Create a Resend account and verify a sending domain (see Resend docs).
2. Add these to `.env`:
   - `RESEND_API_KEY`
   - `RESEND_FROM` (ex: `Century Cup <noreply@mail.yourdomain.com>`)
3. Users go to `/signin` → “Email me a password.”

Passwords are generated on request and emailed in plaintext (per your preference).

## Excel import
- Default path: `./S2026 CC Master Sheet.xlsx` in repo root.
- Admin UI: `Dashboard → Import Excel` (`/admin/import`)
- Payload fields: optional custom file path, season name, year.
- Parser expects columns (case-insensitive):
  - Players sheet: `Name`, `Email`, `Team`, `Conference`
  - Schedule sheet: `Week`, `Home`, `Away`
  - Team sheet (optional): `Team`, `Conference`
- Import creates a new Season, Conferences, Teams, Players, TeamRosters, Schedule rows.

## Historical import (all seasons)
Before running, apply the alias table migration once:
```bash
npx prisma migrate dev --name add-player-alias
```
Then run the multi-season importer:
```bash
node scripts/import-historical.mjs
```
Optional single file run:
```bash
node scripts/import-historical.mjs --file "SOMIL S2026.xlsx"
```
Notes:
- Uses `Name_email_mapping.xlsx` to map nicknames + emails.
- Week sheets (`Week N`) drive game imports; schedule comes from `Full Schedule`.
- Legacy wins use sheet `Result` values (or cell color as fallback). Negative pulled cups are ignored.

## Starting games
- Go to `/games/new`.
- Choose `League` or `Exhibition`.
- League: select teams + week, set a 1–6 shooting order for each team (team roster only).
- Exhibition: pick any player for each 1–6 slot.
- Submit to create the game and land on the live console.

## Live console (mobile-first)
- Big buttons for `Top Regular`, `Top ISO`, `Bottom Regular`, `Bottom ISO`, `Miss`, plus Undo.
- Options menu for pull/add cups and end game.
- Turn logic: 6-shot turns; 2+ makes triggers a bonus turn (same offense). Otherwise possession flips.
- Auto-finalization handles redemption (defense shoots until miss; if they clear, overtime placeholder).

## Stats + formulas
- Box score: makes by type, attempts, FG%.
- Player rating (base weights) + tempo rating (temporal scaling).
- Clutch share (tracked only).

Formulas live here:
- Base weights + box score utilities: `src/lib/stats.ts` (`boxScore`, `baseRatingStats`)
- Tempo rating (temporal scaling): `src/lib/stats.ts` (`advancedStats`)
- Defaults: `src/lib/stats.ts` (`defaultMultipliers`)

## Scripts
- `npm run dev` – start app
- `npm run build` / `npm start` – production
- `npm run lint` – lint
- `npm run prisma:migrate` – migrate dev DB
- `npm run prisma:deploy` – deploy migrations
- `npx prisma db seed` – seed default admin

## Notes
- Database is Postgres only (set `DATABASE_URL`).
- Lineup order is respected; bonus turns keep possession and reuse hitters list.
- Undo recomputes game state from remaining events; empty games keep a fresh turn.
