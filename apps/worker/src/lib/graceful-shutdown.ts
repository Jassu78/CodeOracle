import type { Worker } from "bullmq";
import type IORedis from "ioredis";

const SHUTDOWN_TIMEOUT_MS = 30_000;

export async function registerGracefulShutdown(opts: {
  worker: Worker;
  redis: IORedis;
  onShutdown?: () => Promise<void>;
}): Promise<void> {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, draining worker…`);

    const forceExit = setTimeout(() => {
      console.error("Shutdown timeout — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await opts.worker.close();
      await opts.onShutdown?.();
      await opts.redis.quit();
      clearTimeout(forceExit);
      console.log("Worker shut down cleanly");
      process.exit(0);
    } catch (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
