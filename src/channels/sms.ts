/**
 * SMS 配信 (AWS SNS)
 *
 * payload:
 *   to:   string  — E.164 形式の電話番号 (例: +819012345678)
 *   text: string  — 本文
 *
 * 環境変数:
 *   AWS_REGION            (既定: us-east-1)
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   SMS_SENDER_ID         (任意: SNS Origination Number / Sender ID)
 *
 * AWS 認証情報が未設定の場合は dev モードでログのみ出力する。
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";

let snsClientPromise: Promise<unknown> | null = null;

async function getSnsClient(): Promise<{
  client: unknown;
  PublishCommand: unknown;
} | null> {
  const accessKey = process.env.AWS_ACCESS_KEY_ID ?? "";
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY ?? "";
  if (!accessKey || !secretKey) return null;

  try {
    if (!snsClientPromise) {
      snsClientPromise = import("@aws-sdk/client-sns");
    }
    const mod = (await snsClientPromise) as {
      SNSClient: new (cfg: Record<string, unknown>) => unknown;
      PublishCommand: new (input: Record<string, unknown>) => unknown;
    };
    const region = process.env.AWS_REGION ?? "us-east-1";
    const client = new mod.SNSClient({
      region,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });
    return { client, PublishCommand: mod.PublishCommand };
  } catch (err) {
    console.warn(
      "[sms] @aws-sdk/client-sns load failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export const smsDispatcher: ChannelDispatcher = {
  channel: "sms",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    const to = p.to as string | undefined;
    const text = p.text as string | undefined;
    if (!to || !text) {
      return { success: false, error: "sms payload requires 'to' and 'text'" };
    }
    if (!to.startsWith("+")) {
      return { success: false, error: "sms 'to' must be E.164 format (+countrycode...)" };
    }

    const sns = await getSnsClient();
    if (!sns) {
      console.log(`[sms:dev] to=${to} text="${text}"`);
      return { success: true, responseBody: "dev mode (AWS credentials not configured)" };
    }

    try {
      const senderId = process.env.SMS_SENDER_ID;
      const attrs: Record<string, unknown> = {
        "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
      };
      if (senderId) {
        attrs["AWS.SNS.SMS.SenderID"] = { DataType: "String", StringValue: senderId };
      }

      const PublishCommand = sns.PublishCommand as new (input: Record<string, unknown>) => unknown;
      const command = new PublishCommand({
        PhoneNumber: to,
        Message: text,
        MessageAttributes: attrs,
      });
      const client = sns.client as { send: (cmd: unknown) => Promise<{ MessageId?: string }> };
      const res = await client.send(command);
      return {
        success: true,
        responseBody: res.MessageId ? `MessageId=${res.MessageId}` : "sent",
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
