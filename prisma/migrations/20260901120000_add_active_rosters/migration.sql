-- TeamRoster keeps every team a Player represented historically. isActive marks
-- the one team they may currently represent in a season. Existing rows start
-- inactive so legacy multi-team history remains valid; only the fully audited
-- F2026 roster is activated below.
BEGIN;

ALTER TABLE "TeamRoster"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE
  target_season_count INTEGER;
  target_season_id TEXT;
  roster_count INTEGER;
  distinct_player_count INTEGER;
  null_team_count INTEGER;
  cross_season_team_count INTEGER;
BEGIN
  SELECT COUNT(*), MIN("id")
  INTO target_season_count, target_season_id
  FROM "Season"
  WHERE LOWER("name") = LOWER('F2026');

  IF target_season_count <> 1 OR target_season_id IS NULL THEN
    RAISE EXCEPTION 'Active-roster migration requires exactly one F2026 season; found %', target_season_count;
  END IF;

  SELECT
    COUNT(*),
    COUNT(DISTINCT roster."playerId"),
    COUNT(*) FILTER (WHERE roster."teamId" IS NULL),
    COUNT(*) FILTER (
      WHERE roster."teamId" IS NOT NULL
        AND team."seasonId" IS DISTINCT FROM roster."seasonId"
    )
  INTO roster_count, distinct_player_count, null_team_count, cross_season_team_count
  FROM "TeamRoster" AS roster
  LEFT JOIN "Team" AS team ON team."id" = roster."teamId"
  WHERE roster."seasonId" = target_season_id;

  IF roster_count <> 42 THEN
    RAISE EXCEPTION 'Active-roster migration expected 42 F2026 memberships; found %', roster_count;
  END IF;

  IF distinct_player_count <> roster_count THEN
    RAISE EXCEPTION 'Active-roster migration found duplicate F2026 Player memberships';
  END IF;

  IF null_team_count <> 0 THEN
    RAISE EXCEPTION 'Active-roster migration found % F2026 memberships without a team', null_team_count;
  END IF;

  IF cross_season_team_count <> 0 THEN
    RAISE EXCEPTION 'Active-roster migration found % F2026 memberships linked to another season', cross_season_team_count;
  END IF;

  UPDATE "TeamRoster"
  SET "isActive" = true
  WHERE "seasonId" = target_season_id;
END $$;

CREATE UNIQUE INDEX "TeamRoster_one_active_team_per_player_season"
ON "TeamRoster" ("seasonId", "playerId")
WHERE "isActive" = true AND "seasonId" IS NOT NULL;

ALTER TABLE "TeamRoster"
ALTER COLUMN "isActive" SET DEFAULT true;

COMMIT;
