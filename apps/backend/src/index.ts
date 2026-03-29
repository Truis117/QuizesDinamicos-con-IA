import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

const server = app.listen(env.PORT, "0.0.0.0", () => {
  logger.info(`Server listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  server.close(() => {
    process.exit(0);
  });
});
