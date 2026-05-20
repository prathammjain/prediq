-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Market" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "imageUrl" TEXT,
    "resolutionSource" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    "liquidityB" REAL NOT NULL DEFAULT 500,
    "useLsLmsr" BOOLEAN NOT NULL DEFAULT false,
    "lsAlpha" REAL NOT NULL DEFAULT 0.05,
    "status" TEXT NOT NULL DEFAULT 'LIVE',
    "proposedOutcomeIndex" INTEGER,
    "proposedAt" DATETIME,
    "disputeUntil" DATETIME,
    "resolvedOutcomeIndex" INTEGER,
    "resolvedAt" DATETIME,
    CONSTRAINT "Market_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Market" ("category", "createdAt", "description", "disputeUntil", "endTime", "id", "imageUrl", "liquidityB", "ownerId", "proposedAt", "proposedOutcomeIndex", "resolutionSource", "resolvedAt", "resolvedOutcomeIndex", "status") SELECT "category", "createdAt", "description", "disputeUntil", "endTime", "id", "imageUrl", "liquidityB", "ownerId", "proposedAt", "proposedOutcomeIndex", "resolutionSource", "resolvedAt", "resolvedOutcomeIndex", "status" FROM "Market";
DROP TABLE "Market";
ALTER TABLE "new_Market" RENAME TO "Market";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
