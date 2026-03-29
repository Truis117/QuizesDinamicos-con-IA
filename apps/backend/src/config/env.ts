import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  JWT_ACCESS_SECRET: z.string().min(16).default("dev_access_secret_change_me_1234"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL_PRIMARY: z
    .string()
    .default("meta-llama/llama-3.1-8b-instruct:free"),
  OPENROUTER_MODEL_FALLBACK: z
    .string()
    .default("meta-llama/llama-3.1-8b-instruct:free"),
  OPENROUTER_SITE_URL: z.string().url().default("http://localhost:3000"),
  OPENROUTER_SITE_NAME: z.string().default("QuizDinamico AI")
});

export const env = EnvSchema.parse(process.env);
