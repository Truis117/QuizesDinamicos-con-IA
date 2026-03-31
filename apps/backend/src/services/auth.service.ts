import { prisma } from "../lib/prisma.js";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../config/env.js";
import { RegisterBody, LoginBody } from "@quiz/contracts";

export class AuthService {
  async register(data: RegisterBody) {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new Error("Email already in use");

    const passwordHash = await argon2.hash(data.password);
    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
      },
    });

    return this.generateTokens(user.id);
  }

  async login(data: LoginBody) {
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) throw new Error("Invalid credentials");

    const valid = await argon2.verify(user.passwordHash, data.password);
    if (!valid) throw new Error("Invalid credentials");

    return this.generateTokens(user.id);
  }

  async refresh(refreshTokenStr: string) {
    const tokenHash = crypto.createHash("sha256").update(refreshTokenStr).digest("hex");
    const token = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!token || token.revoked || token.expiresAt < new Date()) {
      throw new Error("Invalid refresh token");
    }

    // Revoke old token and issue new
    await prisma.refreshToken.update({
      where: { id: token.id },
      data: { revoked: true, revokedAt: new Date() },
    });

    return this.generateTokens(token.userId);
  }

  async logout(refreshTokenStr: string) {
    const tokenHash = crypto.createHash("sha256").update(refreshTokenStr).digest("hex");
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    });
  }

  private async generateTokens(userId: string) {
    const accessToken = jwt.sign({ userId }, env.JWT_ACCESS_SECRET, {
      expiresIn: env.ACCESS_TOKEN_TTL as any,
    });

    const refreshTokenRaw = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(refreshTokenRaw).digest("hex");

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + env.REFRESH_TOKEN_TTL_DAYS);

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenRaw,
      user: { id: userId }
    };
  }

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        currentStreak: true,
        globalScore: true
      }
    });
    if (!user) throw new Error("User not found");
    return user;
  }
}
