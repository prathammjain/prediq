-- Tracks the moment a user placed their first BUY trade. Used by the
-- frontend to gate the new-user welcome card on Home and the first-trade
-- explainer panel inside BuyModal. Nullable on purpose: a value of NULL
-- means "has never traded", which is the trigger condition.
ALTER TABLE "User" ADD COLUMN "firstTradeAt" DATETIME;
