import { Router } from "express";
import { prisma } from "../db";
import bcrypt from "bcrypt";
import { signToken } from "../auth/jwt";
import { scopesForRole } from "../auth/rbac";

const r = Router();

r.post("/login", async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  let ok = false;
  if (user.password.startsWith("$2")) {
    ok = await bcrypt.compare(password, user.password).catch(() => false);
  } else {
    ok = password === user.password;
  }
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const scopes = scopesForRole(user.role);
  const token = signToken({ sub: user.id, email: user.email, role: user.role, scopes });

  return res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, scopes },
  });
});

import { authenticate } from "../middleware/auth";

r.get("/me", authenticate, async (req, res) => {
  const user = (req as any).user as { id: number; email: string; role: string; scopes: string[] } | undefined;
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const db = await prisma.user.findUnique({ where: { id: user.id } });
  if (!db) return res.status(401).json({ error: "Unauthorized" });
  return res.json({ id: db.id, email: db.email, name: db.name, role: db.role, scopes: user.scopes });
});

export default r;
