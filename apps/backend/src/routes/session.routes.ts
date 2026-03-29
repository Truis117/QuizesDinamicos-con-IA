import { Router } from "express";
import type { IRouter } from "express";
import { SessionController } from "../controllers/session.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const sessionRouter: IRouter = Router();
const controller = new SessionController();

sessionRouter.use(requireAuth);

sessionRouter.post("/", (req, res, next) => { controller.createSession(req, res, next).catch(next); });
sessionRouter.get("/", (req, res, next) => { controller.listSessions(req, res, next).catch(next); });
sessionRouter.get("/:id", (req, res, next) => { controller.getSession(req, res, next).catch(next); });

sessionRouter.post("/:id/rounds", (req, res, next) => { controller.createRound(req, res, next).catch(next); });
sessionRouter.get("/:id/stream", (req, res, next) => { controller.streamRound(req, res, next).catch(next); });
sessionRouter.post("/:id/questions/:questionId/attempt", (req, res, next) => { controller.attemptQuestion(req, res, next).catch(next); });
sessionRouter.get("/:id/summary", (req, res, next) => { controller.getSummary(req, res, next).catch(next); });
