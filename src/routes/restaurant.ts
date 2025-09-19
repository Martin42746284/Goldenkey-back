import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { requireScope } from "../middleware/requireScope";

const r = Router();

r.get("/tables", requireScope("orders:read"), async (_req, res) => {
  const tables = await prisma.diningTable.findMany({ where: { department: { in: ["restaurant", "pub"] } } });
  res.json(tables);
});

r.post("/tables", requireScope("orders:write"), async (req, res) => {
  const schema = z.object({ code: z.string(), department: z.enum(["restaurant","pub"]) });
  const created = await prisma.diningTable.create({ data: schema.parse(req.body) });
  res.status(201).json(created);
});

r.patch("/tables/:id", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ code: z.string().optional() });
  const updated = await prisma.diningTable.update({ where: { id }, data: schema.parse(req.body) });
  res.json(updated);
});

r.delete("/tables/:id", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const hasOrders = await prisma.order.count({ where: { tableId: id } });
  if (hasOrders) return res.status(400).json({ error: "Cannot delete table with orders" });
  await prisma.diningTable.delete({ where: { id } });
  res.status(204).end();
});

r.get("/orders", requireScope("orders:read"), async (req, res) => {
  try {
    // Validation des paramètres de requête
    const schema = z.object({
      dept: z.enum(["restaurant", "pub", "spa"]).optional(),
      status: z.enum(["open", "closed", "cancelled"]).optional(),
    });
    
    const { dept, status } = schema.parse(req.query);
    
    const orders = await prisma.order.findMany({
      where: {
        ...(dept ? { dept } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        lines: true,
        table: true,
      },
      orderBy: {
        openedAt: "desc",
      },
    });

    // Ajouter des en-têtes de cache pour optimiser les performances
    res.set({
      'Cache-Control': 'private, max-age=10',
      'ETag': `"orders-${dept}-${status}-${Date.now()}"`,
    });
    
    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Invalid parameters",
        details: error.errors,
      });
    }

    // En cas d'erreur de base de données, renvoyer un tableau vide
    // mais avec un code d'état approprié
    res.status(503).json({
      data: [],
      error: "Database temporarily unavailable",
      retry: true,
    });
  }
});

r.get("/orders/:id", requireScope("orders:read"), async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({ where: { id }, include: { lines: true, table: true, payments: true } });
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

r.post("/orders", requireScope("orders:write"), async (req, res) => {
  const schema = z.object({ dept: z.enum(["restaurant","pub","spa"]).default("restaurant"), tableCode: z.string().optional(), tabId: z.number().int().optional() });
  const input = schema.parse(req.body);
  const table = input.tableCode ? await prisma.diningTable.findUnique({ where: { code: input.tableCode } }) : null;
  const created = await prisma.order.create({ data: { dept: input.dept, tableId: table?.id, status: "open", tabId: input.tabId } });
  res.status(201).json(created);
});

r.post("/orders/:id/lines", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ itemId: z.number().int(), qty: z.number().int().min(1) });
  const input = schema.parse(req.body);
  const item = await prisma.item.findUniqueOrThrow({ where: { id: input.itemId } });
  const line = await prisma.orderLine.create({ data: { orderId: id, itemId: item.id, itemName: item.name, qty: input.qty, unitPrice: item.salePriceDefault, fireStatus: "commanded" } });
  res.status(201).json(line);
});

r.delete("/orders/:id/lines/:lineId", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  const order = await prisma.order.findUniqueOrThrow({ where: { id } });
  if (order.status !== "open") return res.status(400).json({ error: "Cannot modify closed/cancelled order" });
  await prisma.orderLine.delete({ where: { id: lineId } });
  res.status(204).end();
});

r.patch("/orders/:id/lines/:lineId/status", requireScope("orders:status"), async (req, res) => {
  const id = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  await prisma.order.findUniqueOrThrow({ where: { id } });
  const schema = z.object({ status: z.enum(["commanded","preparing","ready","delivered","voided"]) });
  const updated = await prisma.orderLine.update({ where: { id: lineId }, data: { fireStatus: schema.parse(req.body).status } });
  res.json(updated);
});

// Update order line (qty / unitPrice)
r.patch("/orders/:id/lines/:lineId", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  await prisma.order.findUniqueOrThrow({ where: { id } });
  const schema = z.object({ qty: z.number().int().min(1).optional(), unitPrice: z.number().int().min(0).optional() });
  const data = schema.parse(req.body);
  const updated = await prisma.orderLine.update({ where: { id: lineId }, data });
  res.json(updated);
});

r.patch("/orders/:id/status", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ status: z.enum(["open","closed","cancelled"]) });
  const updated = await prisma.order.update({ where: { id }, data: { status: schema.parse(req.body).status, ...(req.body.status === "closed" ? { closedAt: new Date() } : {}) } });
  res.json(updated);
});

r.delete("/orders/:id", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({ where: { id }, include: { payments: true } });
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.payments.length) return res.status(400).json({ error: "Cannot delete order with payments" });
  await prisma.orderLine.deleteMany({ where: { orderId: id } });
  await prisma.order.delete({ where: { id } });
  res.status(204).end();
});

r.post("/orders/:id/close", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({
    where: { id },
    include: { lines: true }
  });

  if (!order) return res.status(404).json({ error: "Order not found" });

  const total = order.lines.reduce((s: number, l: typeof order.lines[0]) =>
    s + l.qty * l.unitPrice, 0);

  const closed = await prisma.order.update({
    where: { id },
    data: {
      status: "closed",
      closedAt: new Date()
    }
  });

  res.json({ ...closed, total });
});

// Charge the full order to a hotel folio (creates FolioCharges from order lines)
r.post("/orders/:id/charge-to-folio", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ folioId: z.number().int(), closeOrder: z.boolean().optional().default(false) });
  const input = schema.parse(req.body);

  const order = await prisma.order.findUnique({ where: { id }, include: { lines: true } });
  if (!order) return res.status(404).json({ error: "Order not found" });

  if (!order.lines.length) return res.status(400).json({ error: "Order has no lines" });

  const result = await prisma.$transaction(async (tx) => {
    // Create charges for each line
    for (const l of order.lines) {
      await tx.folioCharge.create({
        data: {
          folioId: input.folioId,
          description: `${l.itemName} x${l.qty}`,
          qty: 1,
          unitPrice: l.qty * l.unitPrice,
          department: order.dept,
        },
      });
    }
    // Recompute folio totals and balance (consider payments)
    const charges = await tx.folioCharge.findMany({ where: { folioId: input.folioId } });
    const payments = await tx.payment.findMany({ where: { folioId: input.folioId } });
    const total = charges.reduce((s, c) => s + c.qty * c.unitPrice, 0);
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    const folio = await tx.folio.update({ where: { id: input.folioId }, data: { total, balance: Math.max(0, total - paid) } });

    // Optionally close order
    let closed: any = null;
    if (input.closeOrder) {
      closed = await tx.order.update({ where: { id }, data: { status: "closed", closedAt: new Date() } });
    }

    return { folio, closed };
  });

  res.status(201).json(result);
});

export default r;
