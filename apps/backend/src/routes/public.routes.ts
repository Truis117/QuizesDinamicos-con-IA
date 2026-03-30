import { Router } from "express";
import type { IRouter } from "express";
import { PublicController } from "../controllers/public.controller.js";

export const publicRouter: IRouter = Router();
const controller = new PublicController();

publicRouter.get("/sessions/:id", (req, res, next) => {
  controller.getPublicSession(req, res, next).catch(next);
});
