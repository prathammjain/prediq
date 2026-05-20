-- AlterTable: add googleId for OAuth linkage
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;

-- Unique index (a single Google account can only link to one predIQ user).
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
