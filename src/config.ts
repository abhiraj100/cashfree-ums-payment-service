import 'dotenv/config';

export function config() {
  const databaseUrl = process.env.DATABASE_URL;
  const token = process.env.ERP_API_TOKEN;
  if (!databaseUrl || !token || token.length < 24) {
    throw new Error('DATABASE_URL and ERP_API_TOKEN (at least 24 characters) are required');
  }
  const port = Number(process.env.PORT ?? 3000);
  const interval = Number(process.env.WORKER_INTERVAL_MS ?? 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(interval) || interval < 1000) {
    throw new Error('Invalid PORT or WORKER_INTERVAL_MS');
  }
  return { databaseUrl, token, port, interval };
}
