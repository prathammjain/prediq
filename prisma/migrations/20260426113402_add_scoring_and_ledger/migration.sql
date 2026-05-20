-- CreateTable
CREATE TABLE "CoinTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "balanceAfter" REAL NOT NULL,
    "marketId" INTEGER,
    "tradeId" INTEGER,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoinTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "conditionType" TEXT NOT NULL,
    "threshold" REAL,
    "iconName" TEXT
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "userId" TEXT NOT NULL,
    "badgeId" INTEGER NOT NULL,
    "earnedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "badgeId"),
    CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Trade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "marketId" INTEGER NOT NULL,
    "outcomeIndex" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "shares" REAL NOT NULL,
    "chipsDelta" REAL NOT NULL,
    "avgFillPrice" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "graded" BOOLEAN NOT NULL DEFAULT false,
    "isCorrect" BOOLEAN,
    "brierLoss" REAL,
    "logLoss" REAL,
    "pasDelta" REAL,
    "numOutcomes" INTEGER,
    CONSTRAINT "Trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Trade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Trade" ("avgFillPrice", "chipsDelta", "createdAt", "id", "marketId", "outcomeIndex", "shares", "side", "userId") SELECT "avgFillPrice", "chipsDelta", "createdAt", "id", "marketId", "outcomeIndex", "shares", "side", "userId" FROM "Trade";
DROP TABLE "Trade";
ALTER TABLE "new_Trade" RENAME TO "Trade";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "handle" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chipsBalance" REAL NOT NULL DEFAULT 0,
    "lastBonusAt" DATETIME,
    "pasRating" REAL NOT NULL DEFAULT 1500,
    "pasPeak" REAL NOT NULL DEFAULT 1500,
    "brierSum" REAL NOT NULL DEFAULT 0,
    "logScoreSum" REAL NOT NULL DEFAULT 0,
    "gradedTrades" INTEGER NOT NULL DEFAULT 0,
    "correctTrades" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "totalStaked" REAL NOT NULL DEFAULT 0,
    "totalPnL" REAL NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'anonymous'
);
INSERT INTO "new_User" ("chipsBalance", "createdAt", "email", "handle", "id", "lastBonusAt") SELECT "chipsBalance", "createdAt", "email", "handle", "id", "lastBonusAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CoinTransaction_userId_createdAt_idx" ON "CoinTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_slug_key" ON "Badge"("slug");
