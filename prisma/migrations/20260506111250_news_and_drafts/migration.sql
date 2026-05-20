-- CreateTable
CREATE TABLE "NewsItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "source" TEXT NOT NULL,
    "publishedAt" DATETIME,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "drafted" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "MarketDraft" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "outcomes" TEXT NOT NULL,
    "endTime" DATETIME NOT NULL,
    "resolutionSource" TEXT NOT NULL DEFAULT '',
    "liquidityB" REAL NOT NULL DEFAULT 500,
    "useLsLmsr" BOOLEAN NOT NULL DEFAULT false,
    "lsAlpha" REAL NOT NULL DEFAULT 0.05,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rationale" TEXT,
    "confidence" REAL,
    "newsItemId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "reviewedByHandle" TEXT,
    "approvedMarketId" INTEGER,
    CONSTRAINT "MarketDraft_newsItemId_fkey" FOREIGN KEY ("newsItemId") REFERENCES "NewsItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_url_key" ON "NewsItem"("url");

-- CreateIndex
CREATE INDEX "NewsItem_fetchedAt_idx" ON "NewsItem"("fetchedAt");

-- CreateIndex
CREATE INDEX "MarketDraft_status_createdAt_idx" ON "MarketDraft"("status", "createdAt");
