-- communityType era autodeclarado en el onboarding y no aportaba control real.
DROP INDEX IF EXISTS "User_communityType_isActive_idx";

ALTER TABLE "User" DROP COLUMN "communityType";

ALTER TABLE "Ticket" DROP COLUMN "reporterCommunityTypeSnapshot";

DROP TYPE "CommunityType";
