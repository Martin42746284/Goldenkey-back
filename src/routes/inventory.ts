import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireScope } from "../middleware/requireScope";

const r = Router();

r.get("/items", requireScope("inventory:read"), async (req, res) => {
  const { isMenu, dept } = req.query as any;
  const items = await prisma.item.findMany({
    where: {
      isActive: true,
      ...(isMenu !== undefined ? { isMenu: isMenu === "true" } : {}),
      ...(dept ? { menuDept: dept } : {}),
    },
    orderBy: { name: "asc" },
  });
  res.json(items);
});

r.get("/items/:id", requireScope("inventory:read"), async (req, res) => {
  const id = Number(req.params.id);
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: "Item not found" });
  res.json(item);
});

r.post("/items", requireScope("inventory:write"), async (req, res) => {
  const schema = z.object({
    sku: z.string(),
    name: z.string(),
    unit: z.enum(["piece","kg","g","L","cl","ml"]),
    vatRate: z.number().int().min(0).max(100),
    costPrice: z.number().int().min(0),
    salePriceDefault: z.number().int().min(0),
    isActive: z.boolean().optional().default(true),
    isMenu: z.boolean().optional(),
    menuDept: z.enum(["hotel","restaurant","pub","spa"]).optional(),
  });
  const data = schema.parse(req.body);
  const created = await prisma.item.create({ data });
  res.status(201).json(created);
});

r.patch("/items/:id", requireScope("inventory:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    name: z.string().optional(),
    vatRate: z.number().int().min(0).max(100).optional(),
    costPrice: z.number().int().min(0).optional(),
    salePriceDefault: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    isMenu: z.boolean().optional(),
    maxQty: z.number().int().min(1).nullable().optional(),
    menuDept: z.enum(["hotel","restaurant","pub","spa"]).nullable().optional(),
  });
  const data = schema.parse(req.body);
  const updated = await prisma.item.update({ where: { id }, data });
  res.json(updated);
});

r.delete("/items/:id", requireScope("inventory:write"), async (req, res) => {
  const id = Number(req.params.id);
  await prisma.stock.deleteMany({ where: { itemId: id } });
  await prisma.orderLine.deleteMany({ where: { itemId: id } });
  await prisma.item.delete({ where: { id } });
  res.status(204).end();
});

r.get("/stores", requireScope("inventory:read"), async (_req, res) => {
  const stores = await prisma.store.findMany();
  res.json(stores);
});

r.get("/stores/:id", requireScope("inventory:read"), async (req, res) => {
  const id = Number(req.params.id);
  const store = await prisma.store.findUnique({ where: { id } });
  if (!store) return res.status(404).json({ error: "Store not found" });
  res.json(store);
});

r.post("/stores", requireScope("inventory:write"), async (req, res) => {
  const schema = z.object({ name: z.string(), department: z.enum(["hotel","restaurant","pub","spa"]) });
  const created = await prisma.store.create({ data: schema.parse(req.body) });
  res.status(201).json(created);
});

r.patch("/stores/:id", requireScope("inventory:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ name: z.string().optional() });
  const updated = await prisma.store.update({ where: { id }, data: schema.parse(req.body) });
  res.json(updated);
});

r.delete("/stores/:id", requireScope("inventory:write"), async (req, res) => {
  const id = Number(req.params.id);
  const hasStocks = await prisma.stock.count({ where: { storeId: id } });
  if (hasStocks) return res.status(400).json({ error: "Cannot delete store with stocks" });
  await prisma.store.delete({ where: { id } });
  res.status(204).end();
});

r.get("/stocks", requireScope("inventory:read"), async (req, res) => {
  const { storeId } = req.query as any;
  const stocks = await prisma.stock.findMany({
    where: { ...(storeId ? { storeId: Number(storeId) } : {}) },
    include: { item: true, store: true },
  });
  res.json(stocks);
});

r.post("/stocks", requireScope("inventory:write"), async (req, res) => {
  const schema = z.object({
    storeId: z.number().int(),
    itemId: z.number().int(),
    qty: z.number().int().min(0),
    minQty: z.number().int().min(0).default(0),
    maxQty: z.number().int().min(1).optional() // Ajout pour seuil max
  });
  try {
    const data = schema.parse(req.body);
    const store = await prisma.store.findUnique({ where: { id: data.storeId } });
    if (!store) return res.status(400).json({ error: "Store not found" });
    const item = await prisma.item.findUnique({ where: { id: data.itemId } });
    if (!item) return res.status(400).json({ error: "Item not found" });

    const created = await prisma.stock.create({
      data: {
        storeId: data.storeId,
        itemId: data.itemId,
        qty: data.qty,
        minQty: data.minQty,
        maxQty: data.maxQty
      }
    });
    res.status(201).json(created);
  } catch (e: any) {
    if (e?.code === 'P2003') return res.status(400).json({ error: 'Foreign key constraint failed' });
    res.status(500).json({ error: String(e) });
  }
});

r.patch("/stocks/:id", requireScope("inventory:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ qty: z.number().int().optional(), minQty: z.number().int().optional(), maxQty: z.number().int().optional() });
  const updated = await prisma.stock.update({ where: { id }, data: schema.parse(req.body) });
  res.json(updated);
});

r.get("/movements", requireScope("inventory:read"), async (req, res) => {
  try {
    const { limit } = req.query as any;
    const l = limit ? Math.min(200, Number(limit)) : 100;
    const moves = await prisma.stockMovement.findMany({ 
      include: { item: true, store: true }, 
      orderBy: { createdAt: "desc" }, 
      take: l 
    });
    res.json(moves);
  } catch (error) {
    console.error('Error fetching stock movements:', error);
    res.json([]);
  }
});

r.post("/movements", requireScope("inventory:adjust"), async (req, res) => {
  const schema = z.object({
    storeId: z.number().int(),
    itemId: z.number().int(),
    qty: z.number().int(),
    type: z.enum(["IN","OUT","ADJUST"]),
    reason: z.string().optional()
  });
  const input = schema.parse(req.body);

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const mv = await tx.stockMovement.create({ data: { ...input } });

    const stock = await tx.stock.upsert({
      where: {
        stock_unique: {
          storeId: input.storeId,
          itemId: input.itemId
        }
      },
      create: {
        storeId: input.storeId,
        itemId: input.itemId,
        qty: 0,
        minQty: 0,
        maxQty: 100 // valeur par défaut
      },
      update: {},
    });

    let qty = stock.qty;
    if (input.type === "IN") qty += input.qty;
    else if (input.type === "OUT") qty -= input.qty;
    else qty = input.qty;

    await tx.stock.update({
      where: { id: stock.id },
      data: { qty }
    });

    return mv;
  });

  res.status(201).json(created);
});

r.delete("/stocks/:id", requireScope("inventory:write"), async (req, res) => {
  const id = Number(req.params.id);
  try {
    await prisma.stock.delete({ where: { id } });
    res.status(204).end();
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

r.get("/alerts", requireScope("inventory:read"), async (req, res) => {
  const { storeId } = req.query as any;
  const where = storeId ? { storeId: Number(storeId) } : {};
  const stocks = await prisma.stock.findMany({ where, include: { item: true, store: true } });
  const out = stocks.filter(s => (s.qty || 0) === 0).map(s => ({ id: s.id, item: s.item, store: s.store, qty: s.qty }));
  const low = stocks.filter(s => (s.qty || 0) <= (s.minQty || 0) && (s.qty || 0) > 0).map(s => ({ id: s.id, item: s.item, store: s.store, qty: s.qty, minQty: s.minQty }));
  res.json({ out, low });
});

export default r;
