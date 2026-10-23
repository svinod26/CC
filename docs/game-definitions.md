# Game State Definitions

## Possession / Turn
- A `Turn` record tracks one rack sequence for one offense team.
- Bonus racks can be stored as separate turn records, but UI flow should treat contiguous same-offense racks as one logical turn.
- `currentShooterIndex` is always relative to the active turn's shooter list.

## Shot Results
- Cup-making shots: `TOP_REGULAR`, `TOP_ISO`, `BOTTOM_REGULAR`, `BOTTOM_ISO`.
- Non-cup shot: `MISS`.
- Rack adjustments: `PULL_HOME`, `PULL_AWAY`.

## Cup Arithmetic
- Home offense makes reduce away cups.
- Away offense makes reduce home cups.
- `PULL_HOME` reduces home cups by `cupsDelta` (negative `cupsDelta` adds home cups).
- `PULL_AWAY` reduces away cups by `cupsDelta` (negative `cupsDelta` adds away cups).

## Source of Truth
- `TRACKED` games: event log is source of truth.
- `LEGACY` games: imported aggregate stats are source of truth.
- If a tracked game exists for a schedule slot, imports must not overwrite tracked stats.

## Finalized Game Corrections
- Admin corrections on finalized tracked games should preserve `FINAL` status.
- Corrections update event history, then full state is recomputed so score/margin remain consistent.

## Game-page reads
- `GameDataProvider` owns the single shared `/state` subscription: live tracked games poll every three seconds; finished games refresh on mount, focus/reconnection, or reload, not on an interval.
- Successful scorer actions still immediately revalidate the shared snapshot. Do not replace this with delayed polling or append-only event updates (undo/corrections can remove history).
- `src/lib/game-view.ts` defines the shared narrow query contract. Fetch events once and attach them to turns by `turnId`; retain null-turn events in overall statistics. Keep the selected state `updatedAt` for overtime winner-selection invalidation.
