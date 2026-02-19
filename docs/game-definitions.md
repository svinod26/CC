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
