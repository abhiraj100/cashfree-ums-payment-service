import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './http/bootstrap';
import { config } from './config';
import { Database } from './database/database';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

async function main() {
  const settings = config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.useBodyParser('json', { limit: '256kb' });
  configureApp(app);
  const webRoot = join(process.cwd(), 'frontend', 'dist');
  if (existsSync(webRoot)) app.useStaticAssets(webRoot, { index: 'index.html' });
  const shutdown = async () => { await app.close(); await app.get(Database).pool.end(); };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  await app.listen(settings.port);
  console.log(`Sandbox API: http://localhost:${settings.port}/docs`);
}
main().catch(() => { console.error('Startup failed; check configuration and database connectivity'); process.exitCode = 1; });
