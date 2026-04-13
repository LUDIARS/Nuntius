/**
 * PostgreSQL 接続 (Drizzle + postgres.js)
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) {
  console.warn("[db] DATABASE_URL が未設定です。");
}

const client = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export { client as pgClient };
export { schema };
