import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { z } from "zod";
import { authRouter } from "./routes/auth.routes.js";
import { sessionRouter } from "./routes/session.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app: Express = express();

app.use(helmet());
app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/sessions", sessionRouter);

app.all("/api/(.*)", (req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// Serve frontend in production
if (env.NODE_ENV === "production") {
  const frontendDist = path.join(__dirname, "../../frontend/dist");
  app.use(express.static(frontendDist));
  app.get("(.*)", (req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "Validation Error", details: err.errors });
    return;
  }
  
  logger.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});
