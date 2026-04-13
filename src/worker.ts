/**
 * Nuntius 配信ワーカー
 *
 * BullMQ の dispatch キューからジョブを受け取り、DB の scheduled_messages を引いて
 * 該当チャネルの dispatcher を実行し、結果を delivery_logs に書き込む。
 */

import { Worker, type Job } from "bullmq";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/connection.js";
import { redisConnection } from "./queue/connection.js";
import { DISPATCH_QUEUE_NAME, type DispatchJobData } from "./queue/dispatch-queue.js";
import { getDispatcher } from "./channels/index.js";

async function processDispatch(job: Job<DispatchJobData>): Promise<void> {
  const { messageId } = job.data;

  const rows = await db.select().from(schema.scheduledMessages)
    .where(eq(schema.scheduledMessages.id, messageId)).limit(1);
  const msg = rows[0];
  if (!msg) {
    console.warn(`[worker] message not found: ${messageId}`);
    return;
  }

  if (msg.status === "cancelled" || msg.status === "delivered") {
    console.log(`[worker] skip (status=${msg.status}): ${messageId}`);
    return;
  }

  // processing にマーク
  await db.update(schema.scheduledMessages).set({
    status: "processing",
    attempts: msg.attempts + 1,
    lastAttemptAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(schema.scheduledMessages.id, messageId));

  const dispatcher = getDispatcher(msg.channel);
  if (!dispatcher) {
    const error = `No dispatcher for channel: ${msg.channel}`;
    await logDelivery(messageId, msg.channel, false, null, error, null);
    await markFailed(messageId, error);
    return;
  }

  const result = await dispatcher.dispatch(msg);
  await logDelivery(
    messageId,
    msg.channel,
    result.success,
    result.httpStatus ?? null,
    result.error ?? null,
    result.responseBody ?? null,
  );

  if (result.success) {
    await db.update(schema.scheduledMessages).set({
      status: "delivered",
      updatedAt: new Date(),
    }).where(eq(schema.scheduledMessages.id, messageId));
    console.log(`[worker] delivered: ${messageId} → ${msg.channel}`);
  } else {
    // BullMQ がリトライするため throw で失敗を伝える
    throw new Error(result.error ?? "Dispatch failed");
  }
}

async function markFailed(messageId: string, error: string): Promise<void> {
  await db.update(schema.scheduledMessages).set({
    status: "failed",
    updatedAt: new Date(),
  }).where(eq(schema.scheduledMessages.id, messageId));
  console.error(`[worker] failed: ${messageId} — ${error}`);
}

async function logDelivery(
  messageId: string,
  channel: schema.ScheduledMessage["channel"],
  success: boolean,
  httpStatus: number | null,
  error: string | null,
  responseBody: string | null,
): Promise<void> {
  await db.insert(schema.deliveryLogs).values({
    id: uuidv4(),
    messageId,
    channel,
    success,
    httpStatus,
    error,
    responseBody,
  });
}

const worker = new Worker<DispatchJobData>(
  DISPATCH_QUEUE_NAME,
  processDispatch,
  {
    connection: redisConnection,
    concurrency: 10,
  },
);

worker.on("completed", (job) => {
  console.log(`[worker] completed job ${job.id}`);
});

worker.on("failed", async (job, err) => {
  console.warn(`[worker] failed job ${job?.id}:`, err.message);
  // 最大試行回数到達時 → status を failed に
  if (job && job.attemptsMade >= (job.opts.attempts ?? 5)) {
    await markFailed(job.data.messageId, err.message);
  }
});

console.log("[worker] Nuntius dispatch worker started");
