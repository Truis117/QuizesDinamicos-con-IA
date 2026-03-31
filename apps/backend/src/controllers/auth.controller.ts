import { Request, Response, NextFunction } from "express";
import { RegisterBodySchema, LoginBodySchema, RefreshBodySchema } from "@quiz/contracts";
import { AuthService } from "../services/auth.service.js";

export class AuthController {
  private authService = new AuthService();

  async register(req: Request, res: Response, next: NextFunction) {
    const data = RegisterBodySchema.parse(req.body);
    try {
      const result = await this.authService.register(data);
      res.status(201).json(result);
    } catch (err: any) {
      if (err.message === "Email already in use") {
        res.status(400).json({ error: err.message });
      } else {
        next(err);
      }
    }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    const data = LoginBodySchema.parse(req.body);
    try {
      const result = await this.authService.login(data);
      res.json(result);
    } catch (err: any) {
      if (err.message === "Invalid credentials") {
        res.status(401).json({ error: err.message });
      } else {
        next(err);
      }
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    const data = RefreshBodySchema.parse(req.body);
    try {
      const result = await this.authService.refresh(data.refreshToken);
      res.json(result);
    } catch (err: any) {
      if (err.message === "Invalid refresh token") {
        res.status(401).json({ error: err.message });
      } else {
        next(err);
      }
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    const data = RefreshBodySchema.parse(req.body);
    await this.authService.logout(data.refreshToken);
    res.json({ ok: true });
  }

  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const result = await this.authService.getMe(req.userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}
