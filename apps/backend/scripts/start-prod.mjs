import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    child.on("exit", (code) => {
      if ((code ?? 1) === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? 1}`));
    });
  });
}

function hasPrismaMigrations() {
  const migrationsDir = join(process.cwd(), "prisma", "migrations");
  if (!existsSync(migrationsDir)) {
    return false;
  }

  const entries = readdirSync(migrationsDir);
  return entries.some((entry) => {
    const migrationPath = join(migrationsDir, entry, "migration.sql");
    return existsSync(migrationPath) && statSync(migrationPath).isFile();
  });
}

async function main() {
  if (hasPrismaMigrations()) {
    console.log("[start:prod] Prisma migrations found. Running migrate deploy...");
    await run("node", ["./scripts/prisma-with-db-url.mjs", "migrate", "deploy"]);
  } else {
    console.log("[start:prod] No Prisma migrations found. Running db push...");
    await run("node", ["./scripts/prisma-with-db-url.mjs", "db", "push", "--skip-generate"]);
  }

  console.log("[start:prod] Starting API server...");
  await run("node", ["dist/index.js"]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});