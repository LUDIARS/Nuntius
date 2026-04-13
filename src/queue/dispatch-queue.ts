/**
 * 配信キュー (BullMQ)
 *
 * REST/WS でメッセージが投入されると、scheduled_messages に INSERT し、
 * 同時に BullMQ Queue にジョブを enqueue する。Worker が send_at 到来時に
 * 実際のチャネル配信を実行する。
 */

import { Queue } from "bullmq";
import { redisConnection } from "./connection.js";

export const DISPATCH_QUEUE_NAME = "nuntius:dispatch";

export interface DispatchJobData {
  messageId: string;
}

export const dispatchQueue = new Queue<DispatchJobData>(DISPATCH_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

/** 指定時刻にメッセージ配信ジョブを投入 */
export async function enqueueMessage(
  messageId: string,
  sendAt: Date,
  priority: number = 5,
): Promise<void> {
  const delay = Math.max(0, sendAt.getTime() - Date.now());
  await dispatchQueue.add(
    "dispatch",
    { messageId },
    {
      delay,
      priority,
      jobId: `msg:${messageId}`, // idempotent
    },
  );
}

/** メッセージジョブをキャンセル */
export async function cancelMessage(messageId: string): Promise<boolean> {
  const job = await dispatchQueue.getJob(`msg:${messageId}`);
  if (!job) return false;
  await job.remove();
  return true;
}
