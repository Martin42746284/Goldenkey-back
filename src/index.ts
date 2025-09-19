import express from "express";
import cors from "cors";
import morgan from "morgan";
import { ENV } from "./env";
import { prisma } from "./db";
import inventory from "./routes/inventory";
import hotel from "./routes/hotel";
import restaurant from "./routes/restaurant";
import bar from "./routes/bar";
import spa from "./routes/spa";
import cash from "./routes/cash";
import invoices from "./routes/invoices";
import crm from "./routes/crm";
import reports from "./routes/reports";
import notifications from "./routes/notifications";

async function bootstrap() {
  const app = express();
  app.use(cors({ origin: ENV.CORS_ORIGIN }));
  app.use(express.json());
  app.use(morgan("dev"));

  app.get("/health", async (_req, res) => {
    try {
      const result: any = await prisma.$queryRawUnsafe("select now()::text as now");
      const now = result[0]?.now;
      res.json({ ok: true, env: ENV.NODE_ENV, now });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Public auth routes
  const authRoutes = (await import("./routes/auth")).default;
  app.use("/auth", authRoutes);
  app.use("/api/auth", authRoutes);

  // Authenticated routes from here
  const { authenticate } = await import("./middleware/auth");
  app.use(authenticate);

  app.use("/inventory", inventory);
  app.use("/hotel", hotel);
  app.use("/restaurant", restaurant);
  app.use("/bar", bar);
  app.use("/spa", spa);
  app.use("/cash", cash);
  app.use("/invoices", invoices);
  app.use("/crm", crm);
  app.use("/reports", reports);
  app.use("/notifications", notifications);

  // Optional alias with /api prefix
  app.use("/api/inventory", inventory);
  app.use("/api/hotel", hotel);
  app.use("/api/restaurant", restaurant);
  app.use("/api/bar", bar);
  app.use("/api/spa", spa);
  app.use("/api/cash", cash);
  app.use("/api/invoices", invoices);
  app.use("/api/crm", crm);
  app.use("/api/reports", reports);
  app.use("/api/notifications", notifications);
  app.get("/api/health", (_req, res) => res.redirect(302, "/health"));

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  });

  let dbConnected = false;
  try {
    await prisma.$connect();
    // Solution 2: Utilisez queryRaw sans type générique ici aussi
    await prisma.$queryRawUnsafe("select 1");
    dbConnected = true;
  } catch (e) {
    console.error("Database connection failed:", e);
  }

  app.listen(ENV.PORT, () => {
    const PORT = ENV.PORT;
    console.log("\n🎉 === SERVEUR DÉMARRÉ ===");
    console.log(`🚀 Serveur démarré sur le port ${PORT}`);
    console.log(`📝 API disponible sur: http://localhost:${PORT}/`);
    console.log(`📝 Alias API: http://localhost:${PORT}/api`);
    console.log(`❤️  Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Base de données: ${dbConnected ? "✅ Connectée" : "⚠️  Mode fallback"}`);
    console.log("\n👀 Prêt à recevoir des requêtes...\n");
  });
}

bootstrap().catch((e) => {
  console.error("Fatal error while starting server:", e);
  process.exit(1);
});
