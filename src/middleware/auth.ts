import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth/jwt";
import { prisma } from "../db";
import { scopesForRole } from "../auth/rbac";

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ error: "Invalid token" });

    (req as any).user = {
      id: user.id,
      email: user.email,
      role: user.role,
      scopes: payload.scopes?.length ? payload.scopes : scopesForRole(user.role),
    };

    next();
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}
