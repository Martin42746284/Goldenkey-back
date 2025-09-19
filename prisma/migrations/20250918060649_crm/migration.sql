-- CreateEnum
CREATE TYPE "Segment" AS ENUM ('vip', 'corporate', 'leisure', 'ota');

-- CreateEnum
CREATE TYPE "LoyaltyTier" AS ENUM ('Bronze', 'Silver', 'Gold', 'Platinum');

-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "address" TEXT,
ADD COLUMN     "birthDate" TIMESTAMP(3),
ADD COLUMN     "company" TEXT,
ADD COLUMN     "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loyaltyTier" "LoyaltyTier" NOT NULL DEFAULT 'Bronze',
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "segment" "Segment" NOT NULL DEFAULT 'leisure';
