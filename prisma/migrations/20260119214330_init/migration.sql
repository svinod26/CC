-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('LEAGUE', 'EXHIBITION');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'FINAL');

-- CreateEnum
CREATE TYPE "ResultType" AS ENUM ('TOP_REGULAR', 'TOP_ISO', 'BOTTOM_REGULAR', 'BOTTOM_ISO', 'MISS', 'PULL_HOME', 'PULL_AWAY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conference" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT,
    "name" TEXT NOT NULL,
    "conferenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamRoster" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT,
    "teamId" TEXT,
    "playerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT,
    "type" "GameType" NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "homeTeamId" TEXT,
    "awayTeamId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "location" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "statTakerId" TEXT,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameLineup" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT,
    "playerId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameLineup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turn" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "offenseTeamId" TEXT,
    "turnIndex" INTEGER NOT NULL,
    "isBonus" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shootersJson" JSONB,

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShotEvent" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "turnId" TEXT,
    "offenseTeamId" TEXT,
    "defenseTeamId" TEXT,
    "shooterId" TEXT,
    "resultType" "ResultType" NOT NULL,
    "cupsDelta" INTEGER NOT NULL DEFAULT 0,
    "remainingCupsBefore" INTEGER NOT NULL,
    "remainingCupsAfter" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "ShotEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameState" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "possessionTeamId" TEXT,
    "homeCupsRemaining" INTEGER NOT NULL DEFAULT 100,
    "awayCupsRemaining" INTEGER NOT NULL DEFAULT 100,
    "currentTurnNumber" INTEGER NOT NULL DEFAULT 1,
    "currentShooterIndex" INTEGER NOT NULL DEFAULT 0,
    "status" "GameStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "homeTeamId" TEXT,
    "awayTeamId" TEXT,
    "gameId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Conference_seasonId_name_key" ON "Conference"("seasonId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Team_seasonId_name_key" ON "Team"("seasonId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TeamRoster_seasonId_playerId_teamId_key" ON "TeamRoster"("seasonId", "playerId", "teamId");

-- CreateIndex
CREATE INDEX "Game_status_idx" ON "Game"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GameLineup_gameId_teamId_playerId_key" ON "GameLineup"("gameId", "teamId", "playerId");

-- CreateIndex
CREATE INDEX "Turn_gameId_turnIndex_idx" ON "Turn"("gameId", "turnIndex");

-- CreateIndex
CREATE INDEX "ShotEvent_gameId_timestamp_idx" ON "ShotEvent"("gameId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "GameState_gameId_key" ON "GameState"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_gameId_key" ON "Schedule"("gameId");

-- CreateIndex
CREATE INDEX "Schedule_seasonId_week_idx" ON "Schedule"("seasonId", "week");

-- AddForeignKey
ALTER TABLE "Conference" ADD CONSTRAINT "Conference_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRoster" ADD CONSTRAINT "TeamRoster_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRoster" ADD CONSTRAINT "TeamRoster_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRoster" ADD CONSTRAINT "TeamRoster_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_statTakerId_fkey" FOREIGN KEY ("statTakerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameLineup" ADD CONSTRAINT "GameLineup_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameLineup" ADD CONSTRAINT "GameLineup_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameLineup" ADD CONSTRAINT "GameLineup_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_offenseTeamId_fkey" FOREIGN KEY ("offenseTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotEvent" ADD CONSTRAINT "ShotEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotEvent" ADD CONSTRAINT "ShotEvent_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotEvent" ADD CONSTRAINT "ShotEvent_offenseTeamId_fkey" FOREIGN KEY ("offenseTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotEvent" ADD CONSTRAINT "ShotEvent_defenseTeamId_fkey" FOREIGN KEY ("defenseTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotEvent" ADD CONSTRAINT "ShotEvent_shooterId_fkey" FOREIGN KEY ("shooterId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameState" ADD CONSTRAINT "GameState_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
