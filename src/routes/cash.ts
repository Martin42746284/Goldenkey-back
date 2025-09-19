import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireScope } from "../middleware/requireScope";

const r = Router();

r.get("/sessions", requireScope("cash:read"), async (req, res) => {
  const { dept } = req.query as any;
  const sessions = await prisma.cashSession.findMany({ where: { ...(dept ? { department: dept } : {}) }, orderBy: { openedAt: "desc" } });
  res.json(sessions);
});

r.post("/sessions/open", requireScope("cash:open"), async (req, res) => {
  const schema = z.object({ department: z.enum(["hotel","restaurant","pub","spa"]), openedBy: z.string(), openingFloat: z.number().int().min(0) });
  const created = await prisma.cashSession.create({ data: { ...schema.parse(req.body), status: "open" } });
  res.status(201).json(created);
});

r.post("/sessions/:id/close", requireScope("cash:close"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ closingAmount: z.number().int().min(0) });
  const input = schema.parse(req.body);
  const closed = await prisma.cashSession.update({ where: { id }, data: { status: "closed", closedAt: new Date(), closingAmount: input.closingAmount } });
  res.json(closed);
});

r.get("/payments", requireScope("payments:read"), async (req, res) => {
  const { dept } = req.query as any;
  const pays = await prisma.payment.findMany({ where: { ...(dept ? { department: dept } : {}) }, orderBy: { receivedAt: "desc" } });
  res.json(pays);
});

r.post("/payments", requireScope("payments:write"), async (req, res) => {
  const schema = z.object({
    department: z.enum(["hotel","restaurant","pub","spa"]),
    method: z.enum(["cash","card","mobile","bank"]),
    amount: z.number().int().min(0),
    orderId: z.number().int().optional(),
    folioId: z.number().int().optional(),
    tabId: z.number().int().optional(),
    cashSessionId: z.number().int().optional(),
    reference: z.string().optional(),
  });
  const input = schema.parse(req.body);

  const targets = [input.orderId, input.folioId, input.tabId].filter(Boolean);
  if (targets.length !== 1) return res.status(400).json({ error: "Provide exactly one of orderId, folioId or tabId" });

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const payment = await tx.payment.create({
      data: {
        amount: input.amount,
        method: input.method,
        department: input.department,
        orderId: input.orderId,
        folioId: input.folioId,
        tabId: input.tabId,
        cashSessionId: input.cashSessionId,
        reference: input.reference,
      },
    });

    if (input.orderId) {
      const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: { lines: true, payments: true } });
      const total = order.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
      const paid = order.payments.reduce((s, p) => s + p.amount, 0);
      const remaining = Math.max(0, total - paid);
      return { payment, context: { type: "order", total, paid, remaining } };
    }

    if (input.folioId) {
      const folio = await tx.folio.findUniqueOrThrow({ where: { id: input.folioId } });
      const newBalance = Math.max(0, folio.balance - input.amount);
      const updated = await tx.folio.update({ where: { id: folio.id }, data: { balance: newBalance, closedAt: newBalance === 0 ? new Date() : folio.closedAt } });
      return { payment, context: { type: "folio", balance: updated.balance, closed: !!updated.closedAt } };
    }

    if (input.tabId) {
      const tab = await tx.tab.findUniqueOrThrow({ where: { id: input.tabId }, include: { orders: { include: { lines: true } }, payments: true } });
      const total = tab.orders.reduce((so, o) => so + o.lines.reduce((sl, l) => sl + l.qty * l.unitPrice, 0), 0);
      const paid = tab.payments.reduce((s, p) => s + p.amount, 0);
      const balance = Math.max(0, total - paid);
      const status = balance === 0 ? "paid" : "unpaid" as const;
      await tx.tab.update({ where: { id: tab.id }, data: { status, balance } });
      return { payment, context: { type: "tab", total, paid, balance, status } };
    }

    return { payment };
  });

  res.status(201).json(result);
});

export default r;
