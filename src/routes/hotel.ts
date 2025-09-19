import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireScope } from "../middleware/requireScope";

const r = Router();

// Rooms
r.get("/rooms", requireScope("rooms:read"), async (_req, res) => {
  const rooms = await prisma.room.findMany({ orderBy: { number: "asc" } });
  res.json(rooms);
});

r.get("/rooms/:id", requireScope("rooms:read"), async (req, res) => {
  const id = Number(req.params.id);
  const room = await prisma.room.findUnique({ where: { id } });
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(room);
});

r.post("/rooms", requireScope("rooms:write"), async (req, res) => {
  const schema = z.object({ number: z.string(), type: z.string(), status: z.enum(["available","occupied","cleaning","maintenance","out_of_order"]) });
  const created = await prisma.room.create({ data: schema.parse(req.body) });
  res.status(201).json(created);
});

r.patch("/rooms/:id", requireScope("rooms:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ number: z.string().optional(), type: z.string().optional(), status: z.enum(["available","occupied","cleaning","maintenance","out_of_order"]).optional() });
  const updated = await prisma.room.update({ where: { id }, data: schema.parse(req.body) });
  res.json(updated);
});

// Backwards-compatible endpoint: update only status
r.patch("/rooms/:id/status", requireScope("rooms:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ status: z.enum(["available","occupied","cleaning","maintenance","out_of_order"]) });
  const input = schema.parse(req.body);
  const updated = await prisma.room.update({ where: { id }, data: { status: input.status } });
  res.json(updated);
});

r.delete("/rooms/:id", requireScope("rooms:write"), async (req, res) => {
  const id = Number(req.params.id);
  const hasRes = await prisma.reservation.count({ where: { roomId: id } });
  if (hasRes) return res.status(400).json({ error: "Cannot delete room with reservations" });
  await prisma.room.delete({ where: { id } });
  res.status(204).end();
});

// Guests
r.get("/guests", requireScope("reservations:read"), async (_req, res) => {
  const guests = await prisma.guest.findMany({ orderBy: { id: "desc" } });
  res.json(guests);
});

r.post("/guests", requireScope("reservations:write"), async (req, res) => {
  const schema = z.object({ fullName: z.string(), phone: z.string().optional(), email: z.string().optional(), notes: z.string().optional() });
  const created = await prisma.guest.create({ data: schema.parse(req.body) });
  res.status(201).json(created);
});

r.patch("/guests/:id", requireScope("reservations:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ fullName: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), notes: z.string().optional() });
  const updated = await prisma.guest.update({ where: { id }, data: schema.parse(req.body) });
  res.json(updated);
});

r.delete("/guests/:id", requireScope("reservations:write"), async (req, res) => {
  const id = Number(req.params.id);
  const hasReservations = await prisma.reservation.count({ where: { guestId: id } });
  if (hasReservations) return res.status(400).json({ error: "Cannot delete guest with reservations" });
  await prisma.guest.delete({ where: { id } });
  res.status(204).end();
});

// Reservations
r.get("/reservations", requireScope("reservations:read"), async (req, res) => {
  const { date } = req.query as any;
  const where = date ? { OR: [{ checkIn: { lte: new Date(date) }, checkOut: { gte: new Date(date) } }] } : {} as any;
  const reservations = await prisma.reservation.findMany({ where, include: { room: true, guest: true, folio: true } });
  res.json(reservations);
});

r.get("/reservations/:id", requireScope("reservations:read"), async (req, res) => {
  const id = Number(req.params.id);
  const reservation = await prisma.reservation.findUnique({ where: { id }, include: { room: true, guest: true, folio: true } });
  if (!reservation) return res.status(404).json({ error: "Reservation not found" });
  res.json(reservation);
});

r.post("/reservations", requireScope("reservations:write"), async (req, res) => {
  const schema = z.object({
    roomId: z.number().int(),
    guest: z.object({
      fullName: z.string(),
      phone: z.string().optional(),
      email: z.string().optional()
    }),
    checkIn: z.string(),
    checkOut: z.string(),
    status: z.enum(["booked","checked_in","checked_out","cancelled","no_show"]).default("booked"),
    rate: z.number().int().min(0)
  });
  const input = schema.parse(req.body);

  const start = new Date(input.checkIn);
  const end = new Date(input.checkOut);

  // Surbooking: blocage si la chambre est déjà réservée sur l'intervalle
  const overlap = await prisma.reservation.findFirst({
    where: {
      roomId: input.roomId,
      status: { in: ["booked", "checked_in"] },
      AND: [
        { checkIn: { lt: end } },
        { checkOut: { gt: start } },
      ],
    },
  });
  if (overlap) return res.status(409).json({ error: "Room already booked for selected dates" });

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const guest = await tx.guest.create({ data: input.guest });
    const reservation = await tx.reservation.create({
      data: {
        roomId: input.roomId,
        guestId: guest.id,
        checkIn: start,
        checkOut: end,
        status: input.status,
        rate: input.rate
      }
    });
    const folio = await tx.folio.create({
      data: {
        reservationId: reservation.id,
        total: 0,
        balance: 0
      }
    });
    return { reservation, folio };
  });

  res.status(201).json(created);
});

r.patch("/reservations/:id", requireScope("reservations:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ roomId: z.number().int().optional(), checkIn: z.string().optional(), checkOut: z.string().optional(), status: z.enum(["booked","checked_in","checked_out","cancelled","no_show"]).optional(), rate: z.number().int().min(0).optional() });
  const input = schema.parse(req.body);

  // If dates or room are changing, ensure no overlap (prevent overbooking)
  if (input.roomId || input.checkIn || input.checkOut) {
    const current = await prisma.reservation.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: "Reservation not found" });
    const roomId = input.roomId ?? current.roomId;
    const start = new Date(input.checkIn ?? current.checkIn);
    const end = new Date(input.checkOut ?? current.checkOut);

    const overlap = await prisma.reservation.findFirst({
      where: {
        id: { not: id },
        roomId,
        status: { in: ["booked", "checked_in"] },
        AND: [
          { checkIn: { lt: end } },
          { checkOut: { gt: start } },
        ],
      },
    });
    if (overlap) return res.status(409).json({ error: "Room already booked for selected dates" });
  }

  const updated = await prisma.reservation.update({ where: { id }, data: { ...input, ...(input.checkIn ? { checkIn: new Date(input.checkIn) } : {}), ...(input.checkOut ? { checkOut: new Date(input.checkOut) } : {}) } });
  res.json(updated);
});

r.delete("/reservations/:id", requireScope("reservations:write"), async (req, res) => {
  const id = Number(req.params.id);
  await prisma.folio.deleteMany({ where: { reservationId: id } });
  await prisma.reservation.delete({ where: { id } });
  res.status(204).end();
});

r.post("/reservations/:id/checkin", requireScope("checkin:write"), async (req, res) => {
  const id = Number(req.params.id);
  const updated = await prisma.reservation.update({ where: { id }, data: { status: "checked_in" } });
  await prisma.room.update({ where: { id: updated.roomId }, data: { status: "occupied" } });
  res.json(updated);
});

r.post("/reservations/:id/checkout", requireScope("checkout:write"), async (req, res) => {
  const id = Number(req.params.id);
  const updated = await prisma.reservation.update({ where: { id }, data: { status: "checked_out" } });
  await prisma.room.update({ where: { id: updated.roomId }, data: { status: "cleaning" } });
  res.json(updated);
});

// Folios
r.get("/folios/:id", requireScope("folios:read"), async (req, res) => {
  const id = Number(req.params.id);
  const folio = await prisma.folio.findUnique({ where: { id }, include: { charges: true, payments: true, reservation: { include: { room: true, guest: true } } } });
  if (!folio) return res.status(404).json({ error: "Folio not found" });
  res.json(folio);
});

r.post("/folios/:id/charge", requireScope("folios:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    description: z.string(),
    qty: z.number().int().min(1),
    unitPrice: z.number().int().min(0),
    department: z.enum(["hotel","restaurant","pub","spa"])
  });
  const input = schema.parse(req.body);

  const charge = await prisma.folioCharge.create({
    data: { ...input, folioId: id }
  });

  const charges = await prisma.folioCharge.findMany({
    where: { folioId: id }
  });

  const total = charges.reduce((s: number, c: typeof charge) =>
    s + c.qty * c.unitPrice, 0);

  await prisma.folio.update({
    where: { id },
    data: { total, balance: total }
  });

  res.status(201).json(charge);
});

r.post("/folios/:id/close", requireScope("folios:write"), async (req, res) => {
  const id = Number(req.params.id);
  const folio = await prisma.folio.update({ where: { id }, data: { closedAt: new Date() } });
  res.json(folio);
});

export default r;
