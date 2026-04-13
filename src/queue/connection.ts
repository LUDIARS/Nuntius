/**
 * BullMQ 用 Redis 接続
 */

import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

/** BullMQ は maxRetriesPerRequest: null 必須 */
export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

redisConnection.on("error", (err) => {
  console.error("[redis] error:", err.message);
});
