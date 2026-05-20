-- Hot-path indexes. Sized for high-DAU read workloads:
--   • Market listing by category / status filter
--   • Leaderboard sort by balance / pas / pnl / streak
--   • Trade grading scan (marketId + graded=false) on resolution
--   • User calibration scan (userId + graded=true) on profile open
--   • Snapshot history fetch (marketId + t)

CREATE INDEX "Market_status_endTime_idx" ON "Market"("status", "endTime");
CREATE INDEX "Market_category_createdAt_idx" ON "Market"("category", "createdAt");

CREATE INDEX "Trade_marketId_graded_idx" ON "Trade"("marketId", "graded");
CREATE INDEX "Trade_userId_graded_idx" ON "Trade"("userId", "graded");
CREATE INDEX "Trade_userId_createdAt_idx" ON "Trade"("userId", "createdAt");

CREATE INDEX "PriceSnapshot_marketId_t_idx" ON "PriceSnapshot"("marketId", "t");

CREATE INDEX "User_chipsBalance_idx" ON "User"("chipsBalance");
CREATE INDEX "User_pasRating_idx" ON "User"("pasRating");
CREATE INDEX "User_totalPnL_idx" ON "User"("totalPnL");
CREATE INDEX "User_streak_idx" ON "User"("streak");
