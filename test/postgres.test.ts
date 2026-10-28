import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { Database } from '../src/database/database';
import { PaymentsService } from '../src/payments/payments.service';
import { Gateway } from '../src/cashfree/cashfree.client';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import { WorkerService } from '../src/jobs/worker.service';

describe.skipIf(!process.env.TEST_DATABASE_URL)('real PostgreSQL transactions, concurrency and worker', () => {
  const schema = `assessment_test_${randomUUID().replaceAll('-', '')}`;
  let admin: Pool;
  let db: Database;
  let service: PaymentsService;
  let worker: WorkerService;
  let gateway: Gateway;
  let invoice: any;
  let order: any;
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    db = new Database(new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 8 }));
    await db.query(readFileSync('migrations/001_initial.sql', 'utf8'));
  });
  afterAll(async () => {
    await db?.pool.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
  });
  beforeEach(async () => {
    await db.query('TRUNCATE fee_invoices,webhook_events CASCADE');
    process.env.PUBLIC_BASE_URL = 'https://test.local';
    process.env.CASHFREE_CLIENT_SECRET = 'test-secret';
    process.env.ERP_MOCK_FAIL = 'false';
    gateway = {
      getOrder: vi.fn(async () => null),
      createOrder: vi.fn(async (body: any) => ({ ...body, cf_order_id: 'cf-test', payment_session_id: 'session-test', order_status: 'ACTIVE' })),
      payments: vi.fn(async () => []),
    };
    service = new PaymentsService(db, gateway);
    worker = new WorkerService(db, service);
    invoice = await service.createInvoice({ erpReference: randomUUID(), studentReference: 'S1', customerPhone: '9999999999', amountMinor: 10000 });
    order = await service.initiate(invoice.id, 'postgres-test-key');
  });
  const success = (id = 'payment-1') => ({ cf_payment_id: id, payment_status: 'SUCCESS', payment_amount: 100, payment_currency: 'INR' });

  it('serializes concurrent new initiation requests on one invoice', async () => {
    const next = await service.createInvoice({ erpReference: randomUUID(), studentReference: 'S2', customerPhone: '9999999999', amountMinor: 10000 });
    const orders = await Promise.all(Array.from({ length: 8 }, (_, i) => service.initiate(next.id, `concurrent-key-${i}`)));
    expect(new Set(orders.map(o => o.id)).size).toBe(1);
    expect((await db.query('SELECT * FROM payment_orders WHERE invoice_id=$1', [next.id])).rows).toHaveLength(1);
  });
  it('serializes concurrent success deliveries into one receipt and outbox', async () => {
    await Promise.all(Array.from({ length: 8 }, () => service.finalize(order.merchant_order_id, success(), 'TEST')));
    expect((await db.query('SELECT * FROM receipts')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM outbox_events')).rows).toHaveLength(1);
    expect((await service.invoice(invoice.id)).status).toBe('PAID');
  });
  it('rolls back financial changes if outbox persistence fails', async () => {
    await db.query("ALTER TABLE outbox_events ADD CONSTRAINT simulated_failure CHECK (state='NEVER')");
    await expect(service.finalize(order.merchant_order_id, success(), 'TEST')).rejects.toThrow();
    expect((await service.invoice(invoice.id)).status).toBe('UNPAID');
    expect((await db.query('SELECT * FROM receipts')).rows).toHaveLength(0);
    expect((await db.query('SELECT * FROM payment_attempts')).rows).toHaveLength(0);
    await db.query('ALTER TABLE outbox_events DROP CONSTRAINT simulated_failure');
  });
  it('processes an accepted inbox event after a worker restart', async () => {
    const raw = Buffer.from(JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: order.merchant_order_id }, payment: success() } }));
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', 'test-secret').update(timestamp).update(raw).digest('base64');
    await new WebhooksService(db).accept(raw, signature, timestamp);
    const restarted = new WorkerService(db, service);
    await restarted.tick();
    expect((await db.query('SELECT state FROM webhook_events')).rows[0].state).toBe('DONE');
    expect((await db.query('SELECT * FROM mock_erp_payments')).rows).toHaveLength(1);
    await restarted.tick();
    expect((await db.query('SELECT * FROM mock_erp_payments')).rows).toHaveLength(1);
  });
  it('retries ERP outage while preserving successful payment', async () => {
    await service.finalize(order.merchant_order_id, success(), 'TEST');
    process.env.ERP_MOCK_FAIL = 'true';
    await worker.tick();
    expect((await db.query('SELECT state,attempts FROM outbox_events')).rows[0]).toMatchObject({ state: 'PENDING', attempts: 1 });
    expect((await service.invoice(invoice.id)).status).toBe('PAID');
    process.env.ERP_MOCK_FAIL = 'false';
    await db.query('UPDATE outbox_events SET next_run_at=now()');
    await worker.tick();
    expect((await db.query('SELECT state FROM outbox_events')).rows[0].state).toBe('DONE');
  });
});
