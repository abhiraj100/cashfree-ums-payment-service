import { Database } from '../database/database';
import { PaymentsService } from '../payments/payments.service';

export class WorkerService {
  constructor(private readonly db: Database, private readonly payments: PaymentsService) {}

  private async finish(table: 'webhook_events' | 'outbox_events', id: string, error?: string) {
    if (!error) { await this.db.query(`UPDATE ${table} SET state='DONE',last_error=NULL WHERE id=$1`, [id]); return; }
    await this.db.query(`UPDATE ${table} SET attempts=attempts+1,
      state=CASE WHEN attempts>=9 THEN 'DEAD' ELSE 'PENDING' END,
      next_run_at=now() + interval '1 second' * LEAST(3600, power(2, attempts+1)::integer),last_error=$2 WHERE id=$1`, [id, error]);
  }

  async tick() {
    // Session advisory lock prevents overlapping workers; crash releases the lock.
    const lock = await this.db.pool.connect();
    try {
      const result = await lock.query('SELECT pg_try_advisory_lock(732105) AS acquired');
      if (!result.rows[0].acquired) return;
      const events = (await this.db.query("SELECT * FROM webhook_events WHERE state='PENDING' AND next_run_at<=now() ORDER BY created_at LIMIT 50")).rows;
      for (const row of events) {
        try {
          const event = row.payload;
          if (['PAYMENT_SUCCESS_WEBHOOK', 'PAYMENT_FAILED_WEBHOOK', 'PAYMENT_USER_DROPPED_WEBHOOK'].includes(event.type)) {
            if (!event.data?.order?.order_id || !event.data?.payment) throw new Error('Invalid payment event');
            await this.payments.finalize(event.data.order.order_id, event.data.payment, 'WEBHOOK');
          }
          await this.finish('webhook_events', row.id);
        } catch { await this.finish('webhook_events', row.id, 'Payment event processing failed; inspect the stored event'); }
      }
      const orders = (await this.db.query(`SELECT id FROM payment_orders WHERE (active=TRUE OR status IN ('EXPIRED','TERMINATED','SUPERSEDED'))
        AND (last_checked_at IS NULL OR last_checked_at < now()-interval '60 seconds')
        ORDER BY last_checked_at ASC NULLS FIRST,created_at LIMIT 20`)).rows;
      for (const order of orders) {
        try {
          const local = await this.payments.order(order.id);
          if (local.status === 'CREATING') {
            const key = (await this.db.query('SELECT key FROM idempotency_requests WHERE order_id=$1 LIMIT 1', [order.id])).rows[0]?.key;
            if (key) await this.payments.initiate(local.invoice_id, key);
          }
          await this.payments.verify(order.id);
        } catch { console.warn(JSON.stringify({ event: 'reconciliation_retry', orderId: order.id })); }
        finally { await this.db.query('UPDATE payment_orders SET last_checked_at=now() WHERE id=$1', [order.id]); }
      }
      const outbox = (await this.db.query("SELECT * FROM outbox_events WHERE state='PENDING' AND next_run_at<=now() LIMIT 50")).rows;
      for (const event of outbox) {
        try {
          if (process.env.ERP_MOCK_FAIL === 'true') throw new Error('Simulated ERP outage');
          await this.db.query('INSERT INTO mock_erp_payments(receipt_id,payload) VALUES($1,$2) ON CONFLICT(receipt_id) DO NOTHING', [event.receipt_id, JSON.stringify(event.payload)]);
          await this.finish('outbox_events', event.id);
        } catch { await this.finish('outbox_events', event.id, 'ERP delivery failed'); }
      }
    } finally {
      await lock.query('SELECT pg_advisory_unlock(732105)');
      lock.release();
    }
  }
}
