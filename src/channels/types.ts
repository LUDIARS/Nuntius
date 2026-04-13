/**
 * チャネル dispatcher の共通インターフェース
 */

import type { ChannelType, ScheduledMessage } from "../db/schema.js";

export interface DispatchResult {
  success: boolean;
  httpStatus?: number;
  error?: string;
  responseBody?: string;
}

export interface ChannelDispatcher {
  channel: ChannelType;
  dispatch(message: ScheduledMessage): Promise<DispatchResult>;
}
