/*
  Warnings:

  - A unique constraint covering the columns `[storeId,itemId]` on the table `Stock` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Stock" ADD COLUMN     "maxQty" INTEGER NOT NULL DEFAULT 100;

-- CreateIndex
CREATE UNIQUE INDEX "Stock_storeId_itemId_key" ON "Stock"("storeId", "itemId");
