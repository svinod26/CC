import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL(
  '../prisma/migrations/20260901120000_add_active_rosters/migration.sql',
  import.meta.url
);
const rosterServicePath = new URL('../src/lib/admin-roster.ts', import.meta.url);

test('active-roster migration is additive and retains every historical row', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE|DROP)\b/i);
  assert.match(sql, /ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT false/i);
  assert.match(sql, /UPDATE "TeamRoster"\s+SET "isActive" = true/i);
  assert.match(sql, /ALTER COLUMN "isActive" SET DEFAULT true/i);
});

test('active-roster migration fails closed unless F2026 is still uniquely safe to activate', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /target_season_count <> 1/i);
  assert.match(sql, /roster_count <> 42/i);
  assert.match(sql, /distinct_player_count <> roster_count/i);
  assert.match(sql, /null_team_count <> 0/i);
  assert.match(sql, /cross_season_team_count <> 0/i);
});

test('active-roster migration enforces at most one active team per player and season', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "TeamRoster_one_active_team_per_player_season"[\s\S]*WHERE "isActive" = true AND "seasonId" IS NOT NULL/i
  );
});

test('roster assignment service never deletes or retargets historical memberships', async () => {
  const source = await readFile(rosterServicePath, 'utf8');
  assert.doesNotMatch(source, /teamRoster\.delete(?:Many)?\s*\(/);
  assert.doesNotMatch(source, /teamRoster\.update[\s\S]{0,500}data:\s*\{[^}]*teamId:/);
  assert.match(source, /data:\s*\{ isActive: false \}/);
  assert.match(source, /data:\s*\{ isActive: true \}/);
  assert.match(source, /TransactionIsolationLevel\.Serializable/);
});
