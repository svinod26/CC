-- CreateEnum
CREATE TYPE "StatsSource" AS ENUM ('TRACKED', 'LEGACY');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "statsSource" "StatsSource" NOT NULL DEFAULT 'TRACKED';

-- CreateTable
CREATE TABLE "LegacyPlayerStat" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT,
    "totalCups" INTEGER NOT NULL DEFAULT 0,
    "topRegular" INTEGER NOT NULL DEFAULT 0,
    "topIso" INTEGER NOT NULL DEFAULT 0,
    "bottomRegular" INTEGER NOT NULL DEFAULT 0,
    "bottomIso" INTEGER NOT NULL DEFAULT 0,
    "misses" INTEGER NOT NULL DEFAULT 0,
    "shotOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyPlayerStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegacyPlayerStat_playerId_idx" ON "LegacyPlayerStat"("playerId");

-- CreateIndex
CREATE INDEX "LegacyPlayerStat_gameId_idx" ON "LegacyPlayerStat"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyPlayerStat_gameId_playerId_key" ON "LegacyPlayerStat"("gameId", "playerId");

-- AddForeignKey
ALTER TABLE "LegacyPlayerStat" ADD CONSTRAINT "LegacyPlayerStat_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyPlayerStat" ADD CONSTRAINT "LegacyPlayerStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyPlayerStat" ADD CONSTRAINT "LegacyPlayerStat_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
