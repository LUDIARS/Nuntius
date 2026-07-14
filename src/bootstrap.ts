/**
 * bootstrap entry — `.env` ファイル無し運用の起動口。 LUDIARS/Cernere#79 と同パターン。
 */
import { ensureEnv } from './lib/env-bootstrap.js';

async function bootstrap(): Promise<void> {
  try {
    await ensureEnv();
  } catch (err) {
    console.error(`[bootstrap] ${(err as Error).message}`);
    process.exit(1);
  }
  await import('./index.js');
}

void bootstrap();
