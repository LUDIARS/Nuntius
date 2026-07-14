/**
 * env-bootstrap — `.env` ファイル無しで Nuntius を起動するための env 注入。
 *
 * (A) Excubitor 経由: catalog.infisical.inject=true で 親が全 secret を child env に注入。
 * (B) 単独起動:        host shell で INFISICAL_CLIENT_ID/SECRET (+ SITE_URL/PROJECT_ID/ENVIRONMENT)
 *
 * Cernere/Actio/Imperativus と同じパターン (LUDIARS/Cernere#79)。
 */

const REQUIRED_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'CERNERE_URL',
  'CERNERE_PROJECT_CLIENT_ID',
  'CERNERE_PROJECT_CLIENT_SECRET',
  'NUNTIUS_ADMIN_PROJECT_KEY',
] as const;

export async function ensureEnv(): Promise<void> {
  const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);
  if (missing.length === 0) {
    console.log('[env-bootstrap] all required env already set');
    return;
  }

  const siteUrl = process.env.INFISICAL_SITE_URL?.replace(/\/$/, '');
  const projectId = process.env.INFISICAL_PROJECT_ID;
  const environment = process.env.INFISICAL_ENVIRONMENT ?? 'dev';
  const clientId = process.env.INFISICAL_CLIENT_ID;
  const clientSecret = process.env.INFISICAL_CLIENT_SECRET;

  if (!siteUrl || !projectId || !clientId || !clientSecret) {
    throw new Error(
      `[env-bootstrap] missing env: ${missing.join(', ')}\n` +
        `Run via Excubitor with catalog.infisical.inject=true, or provide INFISICAL_* host env.`,
    );
  }

  const loginRes = await fetch(`${siteUrl}/api/v1/auth/universal-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!loginRes.ok) {
    throw new Error(`[env-bootstrap] Infisical login failed: ${loginRes.status}`);
  }
  const { accessToken } = (await loginRes.json()) as { accessToken: string };

  const params = new URLSearchParams({ workspaceId: projectId, environment, secretPath: '/' });
  const secretsRes = await fetch(`${siteUrl}/api/v3/secrets/raw?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!secretsRes.ok) {
    throw new Error(`[env-bootstrap] Infisical secrets failed: ${secretsRes.status}`);
  }
  const { secrets } = (await secretsRes.json()) as { secrets: Array<{ secretKey: string; secretValue: string }> };

  let injected = 0;
  for (const s of secrets) {
    if (!process.env[s.secretKey]) {
      process.env[s.secretKey] = s.secretValue;
      injected++;
    }
  }
  console.log(`[env-bootstrap] injected ${injected} secrets from Infisical`);

  const stillMissing = REQUIRED_KEYS.filter((k) => !process.env[k]);
  if (stillMissing.length > 0) {
    throw new Error(`[env-bootstrap] still missing after Infisical fetch: ${stillMissing.join(', ')}`);
  }
}
