import { Request, Response, NextFunction } from "express";
import { CreateSessionBodySchema, CreateRoundBodySchema, AttemptBodySchema } from "@quiz/contracts";
import { SessionService } from "../services/session.service.js";

export class SessionController {
  private sessionService = new SessionService();

  async createSession(req: Request, res: Response, next: NextFunction) {
    try {
      const data = CreateSessionBodySchema.parse(req.body);
      const session = await this.sessionService.createSession(req.userId!, data.topic);
      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  }

  async listSessions(req: Request, res: Response, next: NextFunction) {
    try {
      const sessions = await this.sessionService.listSessions(req.userId!);
      res.json(sessions);
    } catch (err) {
      next(err);
    }
  }

  async getSession(req: Request, res: Response, next: NextFunction) {
    try {
      const session = await this.sessionService.getSession(req.userId!, req.params.id as string);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      res.json(session);
    } catch (err) {
      next(err);
    }
  }

  async createRound(req: Request, res: Response, next: NextFunction) {
    try {
      const data = CreateRoundBodySchema.parse(req.body);
      const round = await this.sessionService.createRound(req.userId!, req.params.id as string, data);
      res.status(201).json(round);
    } catch (err: any) {
      if (err?.message === "Session not found") {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err?.message === "A round is already generating") {
        res.status(409).json({ error: err.message });
        return;
      }
      next(err);
    }
  }

  async streamRound(req: Request, res: Response, next: NextFunction) {
    try {
      await this.sessionService.streamRound(req.userId!, req.params.id as string, req, res);
    } catch (err) {
      next(err);
    }
  }

  async attemptQuestion(req: Request, res: Response, next: NextFunction) {
    try {
      const data = AttemptBodySchema.parse(req.body);
      const result = await this.sessionService.attemptQuestion(
        req.userId!,
        req.params.id as string,
        req.params.questionId as string,
        data
      );
      res.json(result);
    } catch (err: any) {
      if (err?.message === "Question not found") {
        res.status(404).json({ error: err.message });
        return;
      }
      next(err);
    }
  }

  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await this.sessionService.getSessionSummary(req.userId!, req.params.id as string);
      res.json(summary);
    } catch (err: any) {
      if (err?.message === "Session not found") {
        res.status(404).json({ error: err.message });
        return;
      }
      next(err);
    }
  }
}
