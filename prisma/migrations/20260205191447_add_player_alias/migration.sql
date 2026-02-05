-- CreateTable
CREATE TABLE "PlayerAlias" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasKey" TEXT NOT NULL,
    "source" TEXT,
    "playerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerAlias_playerId_idx" ON "PlayerAlias"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAlias_aliasKey_key" ON "PlayerAlias"("aliasKey");

-- AddForeignKey
ALTER TABLE "PlayerAlias" ADD CONSTRAINT "PlayerAlias_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
