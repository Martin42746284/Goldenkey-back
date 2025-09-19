import express from "express";
import { prisma } from "../db";

const router = express.Router();

// List notifications (newest first)
router.get("/", async (_req, res) => {
  try {
    const items = await prisma.notification.findMany({ orderBy: { createdAt: "desc" } });
    res.json(items);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to fetch notifications" });
  }
});

// Mark a notification as read
router.patch("/:id/read", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const updated = await prisma.notification.update({ where: { id }, data: { read: true } });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to mark as read" });
  }
});

// Mark all notifications as read
router.post("/mark-all-read", async (_req, res) => {
  try {
    await prisma.notification.updateMany({ data: { read: true } });
    res.status(204).end();
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to mark all as read" });
  }
});

// Delete a notification
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    await prisma.notification.delete({ where: { id } });
    res.status(204).end();
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to delete notification" });
  }
});

export default router;
