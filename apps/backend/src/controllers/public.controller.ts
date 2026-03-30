import { Request, Response, NextFunction } from "express";
import { SessionService } from "../services/session.service.js";

export class PublicController {
  private sessionService = new SessionService();

  async getPublicSession(req: Request, res: Response, next: NextFunction) {
    try {
      const session = await this.sessionService.getPublicSession(req.params.id as string);

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      res.json(session);
    } catch (err) {
      next(err);
    }
  }
}
