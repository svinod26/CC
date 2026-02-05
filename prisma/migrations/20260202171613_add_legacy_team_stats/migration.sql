-- CreateTable
CREATE TABLE "LegacyTeamStat" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT,
    "pulledCups" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyTeamStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegacyTeamStat_teamId_idx" ON "LegacyTeamStat"("teamId");

-- CreateIndex
CREATE INDEX "LegacyTeamStat_gameId_idx" ON "LegacyTeamStat"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyTeamStat_gameId_teamId_key" ON "LegacyTeamStat"("gameId", "teamId");

-- AddForeignKey
ALTER TABLE "LegacyTeamStat" ADD CONSTRAINT "LegacyTeamStat_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyTeamStat" ADD CONSTRAINT "LegacyTeamStat_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
