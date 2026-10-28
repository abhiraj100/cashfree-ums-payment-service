import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { Database } from '../database/database';
import { Gateway, GatewayPayment, toMinor } from '../cashfree/cashfree.client';

export class PaymentsService {
  constructor(readonly db: Database, readonly gateway: Gateway) {}

  async createInvoice(input: { erpReference: string; studentReference: string; customerPhone: string; amountMinor: number }) {
    try {
      return (await this.db.query(`INSERT INTO fee_invoices(id,erp_reference,student_reference,customer_phone,amount_minor)
        VALUES($1,$2,$3,$4,$5) RETURNING *`, [randomUUID(), input.erpReference, input.studentReference, input.customerPhone, input.amountMinor])).rows[0];
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('ERP invoice reference already exists');
      throw e;
    }
  }
  async invoice(id: string) {
    const row = (await this.db.query('SELECT * FROM fee_invoices WHERE id=$1', [id])).rows[0];
    if (!row) throw new NotFoundException('Invoice not found');
    return row;
  }
  async invoices() {
    const invoices = (await this.db.query(`SELECT i.*,r.id AS receipt_id,r.cf_payment_id
      FROM fee_invoices i LEFT JOIN receipts r ON r.invoice_id=i.id ORDER BY i.created_at DESC LIMIT 100`)).rows;
    if (!invoices.length) return [];
    const orders = (await this.db.query(`SELECT id,invoice_id,status,payment_session_id,created_at
      FROM payment_orders WHERE invoice_id=ANY($1::uuid[]) ORDER BY created_at DESC`, [invoices.map(invoice => invoice.id)])).rows;
    const latest = new Map<string, any>();
    for (const order of orders) if (!latest.has(order.invoice_id)) latest.set(order.invoice_id, order);
    return invoices.map(invoice => {
      const order = latest.get(invoice.id);
      return { ...invoice, payment_order_id: order?.id ?? null, payment_order_status: order?.status ?? null, payment_session_id: order?.payment_session_id ?? null };
    });
  }
  async dashboard() {
    const summary = (await this.db.query(`SELECT
      count(*)::integer AS total_invoices,
      COALESCE(sum(CASE WHEN status='PAID' THEN 1 ELSE 0 END),0)::integer AS paid_invoices,
      COALESCE(sum(CASE WHEN status='UNPAID' THEN 1 ELSE 0 END),0)::integer AS unpaid_invoices,
      COALESCE(sum(CASE WHEN status='PAID' THEN amount_minor ELSE 0 END),0)::bigint AS collected_minor,
      COALESCE(sum(CASE WHEN status='UNPAID' THEN amount_minor ELSE 0 END),0)::bigint AS outstanding_minor
      FROM fee_invoices`)).rows[0];
    const attempts = (await this.db.query(`SELECT count(*)::integer AS total_attempts,
      COALESCE(sum(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END),0)::integer AS successful_attempts
      FROM payment_attempts`)).rows[0];
    return { ...summary, ...attempts, environment: 'sandbox' };
  }
  async order(id: string) {
    const row = (await this.db.query('SELECT * FROM payment_orders WHERE id=$1', [id])).rows[0];
    if (!row) throw new NotFoundException('Order not found');
    return row;
  }
  async attempts(id: string) {
    await this.order(id);
    return (await this.db.query('SELECT * FROM payment_attempts WHERE order_id=$1 ORDER BY updated_at', [id])).rows;
  }
  async receipt(invoiceId: string) {
    await this.invoice(invoiceId);
    const row = (await this.db.query('SELECT * FROM receipts WHERE invoice_id=$1', [invoiceId])).rows[0];
    if (!row) throw new NotFoundException('No successful payment receipt yet');
    return row;
  }

  async initiate(invoiceId: string, key: string, forceNew = false) {
    if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new BadRequestException('Idempotency-Key must contain 8–128 letters, numbers, underscores or hyphens');
    const hash = createHash('sha256').update(invoiceId).digest('hex');
    const sessionMaxAgeMs = 15 * 60 * 1000; // Cashfree sessions expire in ~15-30 minutes
    let reservation: { order: any; invoice: any; isNew: boolean };
    try {
      reservation = await this.db.transaction(async client => {
        // Serializes different keys for the same invoice; never hold this lock over HTTP.
        const invoice = (await client.query('SELECT * FROM fee_invoices WHERE id=$1 FOR UPDATE', [invoiceId])).rows[0];
        if (!invoice) throw new NotFoundException('Invoice not found');
        if (invoice.status === 'PAID') throw new ConflictException('Invoice is already paid');

        let order = (await client.query('SELECT * FROM payment_orders WHERE invoice_id=$1 AND active=TRUE', [invoiceId])).rows[0];

        const isStale = order && (
          forceNew ||
          ['EXPIRED', 'TERMINATED', 'FAILED'].includes(order.status) ||
          (order.payment_session_id && order.created_at && (Date.now() - new Date(order.created_at).getTime() > sessionMaxAgeMs))
        );

        if (order && isStale) {
          await client.query(`UPDATE payment_orders SET active=FALSE, status=CASE WHEN status='PAID' THEN status ELSE 'SUPERSEDED' END WHERE id=$1`, [order.id]);
          order = null;
        }

        let isNew = false;
        if (!order) {
          const id = randomUUID();
          order = (await client.query(`INSERT INTO payment_orders(id,invoice_id,merchant_order_id,gateway_key)
            VALUES($1,$2,$3,$4) RETURNING *`, [id, invoiceId, `ums_${id}`, randomUUID()])).rows[0];
          isNew = true;
        }

        const existing = (await client.query('SELECT * FROM idempotency_requests WHERE key=$1', [key])).rows[0];
        if (existing) {
          if (existing.request_hash !== hash) throw new ConflictException('Idempotency key was used with a different invoice');
          if (isNew) {
            await client.query('UPDATE idempotency_requests SET order_id=$2 WHERE key=$1', [key, order.id]);
          }
        } else {
          await client.query('INSERT INTO idempotency_requests(key,request_hash,order_id) VALUES($1,$2,$3)', [key, hash, order.id]);
        }

        return { order, invoice, isNew };
      });
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('Concurrent request; retry with the same idempotency key');
      throw e;
    }
    const { order, invoice, isNew } = reservation;
    if (order.payment_session_id && order.active && !isNew) return order;
    const publicBase = process.env.PUBLIC_BASE_URL ?? '';
    if (!/^https?:\/\//.test(publicBase) || publicBase.includes('.example')) {
      throw new ServiceUnavailableException('Set PUBLIC_BASE_URL to the public HTTPS or local address of this API');
    }
    let remote = await this.gateway.getOrder(order.merchant_order_id);
    if (!remote || ['EXPIRED', 'TERMINATED'].includes(remote.order_status)) {
      remote = await this.gateway.createOrder({
        order_id: order.merchant_order_id,
        order_amount: Number(invoice.amount_minor) / 100,
        order_currency: invoice.currency,
        customer_details: {
          customer_id: invoice.student_reference.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 50) || 'STUDENT_001',
          customer_phone: invoice.customer_phone,
          customer_name: invoice.student_reference,
        },
        order_meta: { return_url: `${publicBase}/payment-return?order_id={order_id}` },
      }, order.gateway_key);
    }
    if (remote.order_id !== order.merchant_order_id || remote.order_currency !== invoice.currency || toMinor(remote.order_amount) !== Number(invoice.amount_minor)) {
      throw new ServiceUnavailableException('Cashfree order does not match the invoice');
    }
    // A webhook can finalize the order while create-order HTTP is in flight.
    await this.db.query(`UPDATE payment_orders SET cf_order_id=$2,payment_session_id=$3,
      status=CASE WHEN status IN ('PAID','SUPERSEDED') THEN status ELSE $4 END,
      active=CASE WHEN status IN ('PAID','SUPERSEDED') THEN FALSE ELSE $5 END WHERE id=$1`,
    [order.id, String(remote.cf_order_id), remote.payment_session_id ?? null,
      remote.order_status === 'PAID' ? 'VERIFYING' : remote.order_status,
      !['EXPIRED', 'TERMINATED'].includes(remote.order_status)]);
    const updated = await this.order(order.id);
    if ((await this.invoice(invoice.id)).status === 'PAID' && updated.status !== 'PAID') {
      throw new ConflictException('Invoice was paid through another order while checkout was being created');
    }
    return updated;
  }

  async verify(id: string) {
    const order = await this.order(id);
    const remote = await this.gateway.getOrder(order.merchant_order_id);
    if (!remote) throw new ServiceUnavailableException('Cashfree order not visible yet; retry later');
    const invoice = await this.invoice(order.invoice_id);
    if (remote.order_id !== order.merchant_order_id || remote.order_currency !== invoice.currency || toMinor(remote.order_amount) !== Number(invoice.amount_minor)) {
      throw new ConflictException('Gateway order amount or currency mismatch');
    }
    for (const payment of await this.gateway.payments(order.merchant_order_id)) {
      await this.finalize(order.merchant_order_id, payment, 'RECONCILIATION');
    }
    // Only release a checkout after Cashfree confirms expiry/termination.
    // PAID without a matching successful attempt stays unresolved for another reconciliation.
    await this.db.query(`UPDATE payment_orders SET last_checked_at=now(),
      status=CASE WHEN status IN ('PAID','SUPERSEDED') THEN status WHEN $2='PAID' THEN 'VERIFYING' ELSE $2 END,
      active=CASE WHEN status='PAID' THEN FALSE WHEN $2 IN ('EXPIRED','TERMINATED') THEN FALSE ELSE active END WHERE id=$1`, [id, remote.order_status]);
    return this.order(id);
  }

  async exception(client: PoolClient, orderId: string | null, reference: string, reason: string) {
    await client.query(`INSERT INTO payment_exceptions(id,order_id,reference,reason) VALUES($1,$2,$3,$4)
      ON CONFLICT(reference,reason) DO NOTHING`, [randomUUID(), orderId, reference, reason]);
  }

  async finalize(merchantId: string, payment: GatewayPayment, source: string) {
    const paymentId = String(payment.cf_payment_id ?? '');
    if (!paymentId || paymentId.length > 128 || !payment.payment_status) throw new Error('Invalid gateway payment');
    return this.db.transaction(async client => {
      const located = (await client.query('SELECT * FROM payment_orders WHERE merchant_order_id=$1', [merchantId])).rows[0];
      if (!located) {
        await this.exception(client, null, merchantId, 'UNKNOWN_ORDER');
        return;
      }
      // Invoice first: consistent lock order with initiation and other successful orders.
      const invoice = (await client.query('SELECT * FROM fee_invoices WHERE id=$1 FOR UPDATE', [located.invoice_id])).rows[0];
      const order = (await client.query('SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE', [located.id])).rows[0];
      const previous = (await client.query('SELECT * FROM payment_attempts WHERE cf_payment_id=$1', [paymentId])).rows[0];
      if (previous && previous.order_id !== order.id) {
        await this.exception(client, order.id, paymentId, 'PAYMENT_ORDER_MISMATCH');
        return;
      }
      let minor: number;
      try { minor = toMinor(payment.payment_amount); }
      catch { await this.exception(client, order.id, paymentId, 'INVALID_AMOUNT'); return; }
      if ((payment.order_id && payment.order_id !== merchantId) || minor !== Number(invoice.amount_minor) || payment.payment_currency !== invoice.currency) {
        await this.exception(client, order.id, paymentId, 'AMOUNT_CURRENCY_OR_ORDER_MISMATCH');
        return;
      }
      const status = nextAttemptStatus(previous?.status, payment.payment_status);
      await client.query(`INSERT INTO payment_attempts(cf_payment_id,order_id,status,amount_minor,currency)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(cf_payment_id) DO UPDATE SET status=$3,updated_at=now()`,
      [paymentId, order.id, status, minor, payment.payment_currency]);
      if (previous?.status !== status) {
        await client.query(`INSERT INTO payment_status_history(id,order_id,cf_payment_id,previous_status,new_status,source)
          VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(), order.id, paymentId, previous?.status ?? null, status, source]);
      }
      if (status !== 'SUCCESS') return;
      const receipt = (await client.query('SELECT * FROM receipts WHERE invoice_id=$1', [invoice.id])).rows[0];
      await client.query("UPDATE payment_orders SET status='PAID',active=FALSE WHERE id=$1", [order.id]);
      if (receipt) {
        if (receipt.cf_payment_id !== paymentId) await this.exception(client, order.id, paymentId, 'ADDITIONAL_SUCCESS_REQUIRES_REVIEW');
        return;
      }
      const receiptId = randomUUID();
      await client.query("UPDATE fee_invoices SET status='PAID' WHERE id=$1", [invoice.id]);
      await client.query("UPDATE payment_orders SET active=FALSE,status='SUPERSEDED' WHERE invoice_id=$1 AND id<>$2 AND status<>'PAID'", [invoice.id, order.id]);
      await client.query('INSERT INTO receipts(id,invoice_id,cf_payment_id,amount_minor) VALUES($1,$2,$3,$4)', [receiptId, invoice.id, paymentId, minor]);
      await client.query('INSERT INTO outbox_events(id,receipt_id,payload) VALUES($1,$2,$3)',
        [randomUUID(), receiptId, JSON.stringify({ event: 'INVOICE_PAID', receiptId, invoiceId: invoice.id, erpReference: invoice.erp_reference, amountMinor: minor, currency: invoice.currency })]);
    });
  }
}

export function nextAttemptStatus(previous: string | undefined, incoming: string): string {
  if (previous === 'SUCCESS' || incoming === 'SUCCESS') return 'SUCCESS';
  if (previous && ['FAILED', 'CANCELLED', 'USER_DROPPED', 'VOID'].includes(previous) && ['PENDING', 'NOT_ATTEMPTED'].includes(incoming)) return previous;
  return incoming;
}
