import { Queue, Worker, type ConnectionOptions, type Processor } from "bullmq";
import IORedis from "ioredis";
import { JOB_NAMES } from "@codeoracle/contracts";

export const QUEUE_NAME = "codeoracle";

export function createRedisConnection(redisUrl: string): IORedis {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

export function createQueue(connection: ConnectionOptions): Queue {
  return new Queue(QUEUE_NAME, { connection });
}

export function createWorker(
  connection: ConnectionOptions,
  processor: Processor,
  concurrency = 6,
): Worker {
  return new Worker(QUEUE_NAME, processor, { connection, concurrency });
}

export { JOB_NAMES };
