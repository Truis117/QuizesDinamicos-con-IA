import { spawn } from "node:child_process";

function resolveDatabaseUrl(env) {
  if (env.DATABASE_URL && env.DATABASE_URL.trim().length > 0) {
    return env.DATABASE_URL;
  }

  const host = env.POSTGRES_HOST || "localhost";
  const port = env.POSTGRES_PORT || "5432";
  const database = env.POSTGRES_DB || "quizdinamico";
  const user = encodeURIComponent(env.POSTGRES_USER || "quiz_user");
  const password = encodeURIComponent(env.POSTGRES_PASSWORD || "quiz_password");
  const schema = encodeURIComponent(env.POSTGRES_SCHEMA || "public");

  return `postgresql://${user}:${password}@${host}:${port}/${database}?schema=${schema}`;
}

const prismaArgs = process.argv.slice(2);

if (prismaArgs.length === 0) {
  console.error("Missing Prisma arguments. Example: node prisma-with-db-url.mjs migrate deploy");
  process.exit(1);
}

const child = spawn("prisma", prismaArgs, {
  env: {
    ...process.env,
    DATABASE_URL: resolveDatabaseUrl(process.env)
  },
  stdio: "inherit",
  shell: process.platform === "win32"
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
