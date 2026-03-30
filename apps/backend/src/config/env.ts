import "dotenv/config";
import { z } from "zod";

const DbPartsSchema = z.object({
  POSTGRES_HOST: z.string().min(1).default("localhost"),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_DB: z.string().min(1).default("quizdinamico"),
  POSTGRES_USER: z.string().min(1).default("quiz_user"),
  POSTGRES_PASSWORD: z.string().min(1).default("quiz_password"),
  POSTGRES_SCHEMA: z.string().min(1).default("public")
});

function resolveDatabaseUrl(rawEnv: NodeJS.ProcessEnv): string {
  const directDatabaseUrl = rawEnv.DATABASE_URL?.trim();
  if (directDatabaseUrl) {
    return directDatabaseUrl;
  }

  const db = DbPartsSchema.parse(rawEnv);
  const user = encodeURIComponent(db.POSTGRES_USER);
  const password = encodeURIComponent(db.POSTGRES_PASSWORD);
  const schema = encodeURIComponent(db.POSTGRES_SCHEMA);

  return `postgresql://${user}:${password}@${db.POSTGRES_HOST}:${db.POSTGRES_PORT}/${db.POSTGRES_DB}?schema=${schema}`;
}

const resolvedDatabaseUrl = resolveDatabaseUrl(process.env);
// Prisma and runtime code read DATABASE_URL directly.
process.env.DATABASE_URL = resolvedDatabaseUrl;

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url().default(resolvedDatabaseUrl),
  PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  JWT_ACCESS_SECRET: z.string().min(16).default("dev_access_secret_change_me_1234"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL_PRIMARY: z
    .string()
    .default("meta-llama/llama-3.2-3b-instruct:free"),
  OPENROUTER_MODEL_FALLBACK: z
    .string()
    .default("qwen/qwen3-next-80b-a3b-instruct:free"),
  OPENROUTER_SITE_URL: z.string().url().default("http://localhost:3000"),
  OPENROUTER_SITE_NAME: z.string().default("QuizDinamico AI"),
  LLM_CACHE_TTL_SEC: z.coerce.number().int().positive().default(3600),
  SSE_STATE_TTL_SEC: z.coerce.number().int().positive().default(300),
  LLM_PROMPT_TOKEN_COST_USD: z.coerce.number().min(0).default(0),
  LLM_COMPLETION_TOKEN_COST_USD: z.coerce.number().min(0).default(0),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(180),
  API_RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60)
});

export const env = EnvSchema.parse(process.env);
