import { Pool } from 'pg';
import { config } from './config';
import { CashfreeClient } from './cashfree/cashfree.client';
import { Database } from './database/database';
import { PaymentsService } from './payments/payments.service';
import { WorkerService } from './jobs/worker.service';

async function main() {
  const settings = config();
  const db = new Database(new Pool({ connectionString: settings.databaseUrl, max: 5, connectionTimeoutMillis: 5000, statement_timeout: 30000 }));
  const worker = new WorkerService(db, new PaymentsService(db, new CashfreeClient()));
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log('Sandbox worker started');
  while (!stopping) {
    try { await worker.tick(); } catch { console.error('Worker tick failed; will retry'); }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, settings.interval));
  }
  await db.pool.end();
}
main().catch(() => { console.error('Worker startup failed'); process.exitCode = 1; });
