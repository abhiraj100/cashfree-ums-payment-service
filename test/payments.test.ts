import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { Database } from '../src/database/database';
import { PaymentsService, nextAttemptStatus } from '../src/payments/payments.service';
import { Gateway, toMinor, verifySignature } from '../src/cashfree/cashfree.client';
import { WebhooksService } from '../src/webhooks/webhooks.service';

export function memoryDatabase() {
  const memory = newDb();
  memory.public.none(readFileSync('migrations/001_initial.sql', 'utf8'));
  const { Pool } = memory.adapters.createPg();
  return new Database(new Pool());
}

describe('payment lifecycle against the SQL schema (in-memory PostgreSQL emulator)', () => {
  let db: Database;
  let service: PaymentsService;
  let gateway: Gateway;
  let invoice: any;
  let order: any;
  beforeEach(async () => {
    db = memoryDatabase();
    gateway = {
      getOrder: vi.fn(async () => null),
      createOrder: vi.fn(async (body: any) => ({ ...body, cf_order_id: 'cf-1', payment_session_id: 'sandbox-session', order_status: 'ACTIVE' })),
      payments: vi.fn(async () => []),
    };
    service = new PaymentsService(db, gateway);
    process.env.PUBLIC_BASE_URL = 'https://test.local';
    process.env.CASHFREE_CLIENT_SECRET = 'test-secret';
    invoice = await service.createInvoice({ erpReference: randomUUID(), studentReference: 'STUDENT-001', customerPhone: '9999999999', amountMinor: 10000 });
    order = await service.initiate(invoice.id, 'test-key-001');
  });
  afterEach(async () => { await db.pool.end(); });
  const payment = (status: string, id = 'payment-1', amount: number | string = '100.00') => ({ cf_payment_id: id, payment_status: status, payment_amount: amount, payment_currency: 'INR' });

  it('reuses checkout for repeated requests and different keys on the same invoice', async () => {
    expect((await service.initiate(invoice.id, 'test-key-001')).id).toBe(order.id);
    expect((await service.initiate(invoice.id, 'test-key-002')).id).toBe(order.id);
    expect(gateway.createOrder).toHaveBeenCalledTimes(1);
  });
  it('rejects a key reused with a different invoice', async () => {
    const other = await service.createInvoice({ erpReference: randomUUID(), studentReference: 'S2', customerPhone: '9999999999', amountMinor: 10000 });
    await expect(service.initiate(other.id, 'test-key-001')).rejects.toThrow('different invoice');
  });
  it('handles pending then success on the same attempt and duplicate success once', async () => {
    await service.finalize(order.merchant_order_id, payment('PENDING'), 'TEST');
    expect((await service.invoice(invoice.id)).status).toBe('UNPAID');
    await service.finalize(order.merchant_order_id, payment('SUCCESS'), 'TEST');
    await service.finalize(order.merchant_order_id, payment('SUCCESS'), 'TEST');
    expect((await service.invoice(invoice.id)).status).toBe('PAID');
    expect((await db.query('SELECT * FROM receipts')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM outbox_events')).rows).toHaveLength(1);
  });
  it('keeps failed and user-dropped attempts payable', async () => {
    await service.finalize(order.merchant_order_id, payment('FAILED'), 'TEST');
    await service.finalize(order.merchant_order_id, payment('USER_DROPPED', 'payment-2'), 'TEST');
    expect((await service.invoice(invoice.id)).status).toBe('UNPAID');
    expect(await service.attempts(order.id)).toHaveLength(2);
  });
  it('does not downgrade success when an old failure arrives', async () => {
    await service.finalize(order.merchant_order_id, payment('SUCCESS'), 'TEST');
    await service.finalize(order.merchant_order_id, payment('FAILED'), 'TEST');
    expect((await service.attempts(order.id))[0].status).toBe('SUCCESS');
    expect((await service.order(order.id)).status).toBe('PAID');
  });
  it('quarantines amount/currency mismatches and unknown orders', async () => {
    await service.finalize(order.merchant_order_id, payment('SUCCESS', 'bad-amount', 99), 'TEST');
    await service.finalize(order.merchant_order_id, { ...payment('SUCCESS', 'bad-currency'), payment_currency: 'USD' }, 'TEST');
    await service.finalize('unknown', payment('SUCCESS'), 'TEST');
    expect((await service.invoice(invoice.id)).status).toBe('UNPAID');
    expect((await db.query('SELECT * FROM payment_exceptions')).rows).toHaveLength(3);
  });
  it('records additional successful attempts without issuing another receipt', async () => {
    await service.finalize(order.merchant_order_id, payment('SUCCESS'), 'TEST');
    await service.finalize(order.merchant_order_id, payment('SUCCESS', 'payment-2'), 'TEST');
    expect((await db.query('SELECT * FROM receipts')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM payment_exceptions')).rows[0].reason).toBe('ADDITIONAL_SUCCESS_REQUIRES_REVIEW');
  });
  it('recovers a timed-out creation using its original merchant order ID', async () => {
    const next = await service.createInvoice({ erpReference: randomUUID(), studentReference: 'S2', customerPhone: '9999999999', amountMinor: 10000 });
    let remote: any;
    vi.mocked(gateway.createOrder).mockImplementationOnce(async (body: any) => {
      remote = { ...body, cf_order_id: 'remote-created', payment_session_id: 'recovered', order_status: 'ACTIVE' };
      throw new Error('timeout after gateway created order');
    });
    await expect(service.initiate(next.id, 'timeout-key')).rejects.toThrow('timeout');
    vi.mocked(gateway.getOrder).mockResolvedValueOnce(remote);
    const recovered = await service.initiate(next.id, 'timeout-key');
    expect(recovered.payment_session_id).toBe('recovered');
    expect(gateway.createOrder).toHaveBeenCalledTimes(2); // includes beforeEach order
  });
  it('reconciles success when no webhook arrived', async () => {
    vi.mocked(gateway.getOrder).mockResolvedValue({ order_id: order.merchant_order_id, cf_order_id: 'cf-1', order_status: 'PAID', order_amount: 100, order_currency: 'INR' });
    vi.mocked(gateway.payments).mockResolvedValue([payment('SUCCESS')]);
    await service.verify(order.id);
    expect((await service.invoice(invoice.id)).status).toBe('PAID');
  });
  it('keeps a recovered paid gateway order reserved until its successful attempt is verified', async () => {
    const next = await service.createInvoice({ erpReference: randomUUID(), studentReference: 'S2', customerPhone: '9999999999', amountMinor: 10000 });
    vi.mocked(gateway.getOrder).mockImplementation(async id => ({ order_id: id, cf_order_id: 'cf-paid', order_status: 'PAID', order_amount: 100, order_currency: 'INR' }));
    const recovered = await service.initiate(next.id, 'paid-recovery-key');
    expect(recovered.status).toBe('VERIFYING');
    expect(recovered.active).toBe(true);
    expect((await service.initiate(next.id, 'another-recovery-key')).id).toBe(recovered.id);
    expect((await service.invoice(next.id)).status).toBe('UNPAID');
  });
  it('supersedes competing checkouts when a late payment succeeds on an expired order', async () => {
    await db.query("UPDATE payment_orders SET active=FALSE,status='EXPIRED' WHERE id=$1", [order.id]);
    const newer = await service.initiate(invoice.id, 'new-checkout-key');
    await service.finalize(order.merchant_order_id, payment('SUCCESS'), 'TEST');
    expect((await service.order(newer.id)).status).toBe('SUPERSEDED');
    await expect(service.initiate(invoice.id, 'new-checkout-key')).rejects.toThrow('already paid');
  });
  it('deduplicates signed deliveries and rejects tampering', async () => {
    const raw = Buffer.from(JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: order.merchant_order_id }, payment: payment('SUCCESS') } }));
    const timestamp = '1793000000000';
    const signature = createHmac('sha256', 'test-secret').update(timestamp).update(raw).digest('base64');
    const webhooks = new WebhooksService(db);
    await webhooks.accept(raw, signature, timestamp);
    await webhooks.accept(raw, signature, timestamp);
    expect((await db.query('SELECT * FROM webhook_events')).rows).toHaveLength(1);
    await expect(webhooks.accept(Buffer.concat([raw, Buffer.from(' ')]), signature, timestamp)).rejects.toThrow('Invalid Cashfree');
  });
});

describe('signature and monetary rules', () => {
  it('uses exact decimal conversion', () => {
    expect(toMinor('10.01')).toBe(1001);
    expect(toMinor(100)).toBe(10000);
    expect(() => toMinor('1.001')).toThrow();
    expect(() => toMinor('-1')).toThrow();
  });
  it('verifies original bytes including decimal formatting', () => {
    const raw = Buffer.from('{ "amount": 100.00 }');
    const signature = createHmac('sha256', 'secret').update('123').update(raw).digest('base64');
    expect(verifySignature(raw, signature, '123', 'secret')).toBe(true);
    expect(verifySignature(Buffer.from('{"amount":100}'), signature, '123', 'secret')).toBe(false);
    expect(verifySignature(raw, '', '123', 'secret')).toBe(false);
  });
  it('preserves successful and completed attempt states against stale pending events', () => {
    expect(nextAttemptStatus('SUCCESS', 'FAILED')).toBe('SUCCESS');
    expect(nextAttemptStatus('FAILED', 'PENDING')).toBe('FAILED');
    expect(nextAttemptStatus('PENDING', 'SUCCESS')).toBe('SUCCESS');
  });
});
