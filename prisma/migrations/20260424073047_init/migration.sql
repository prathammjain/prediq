-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "handle" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chipsBalance" REAL NOT NULL DEFAULT 0,
    "lastBonusAt" DATETIME
);

-- CreateTable
CREATE TABLE "Market" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "imageUrl" TEXT,
    "resolutionSource" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    "liquidityB" REAL NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'LIVE',
    "proposedOutcomeIndex" INTEGER,
    "proposedAt" DATETIME,
    "disputeUntil" DATETIME,
    "resolvedOutcomeIndex" INTEGER,
    "resolvedAt" DATETIME,
    CONSTRAINT "Market_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Outcome" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "marketId" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sharesOutstanding" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "Outcome_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SharePosition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "marketId" INTEGER NOT NULL,
    "outcomeIndex" INTEGER NOT NULL,
    "shares" REAL NOT NULL DEFAULT 0,
    "chipsSpent" REAL NOT NULL DEFAULT 0,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "SharePosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SharePosition_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "marketId" INTEGER NOT NULL,
    "outcomeIndex" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "shares" REAL NOT NULL,
    "chipsDelta" REAL NOT NULL,
    "avgFillPrice" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Trade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "marketId" INTEGER NOT NULL,
    "t" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "percents" TEXT NOT NULL,
    CONSTRAINT "PriceSnapshot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Outcome_marketId_index_key" ON "Outcome"("marketId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "SharePosition_userId_marketId_outcomeIndex_key" ON "SharePosition"("userId", "marketId", "outcomeIndex");
