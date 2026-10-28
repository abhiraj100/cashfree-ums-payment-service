import { ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type GatewayOrder = { order_id: string; cf_order_id: string | number; payment_session_id?: string; order_status: string; order_amount: number; order_currency: string };
export type GatewayPayment = { cf_payment_id: string | number; order_id?: string; payment_status: string; payment_amount: number | string; payment_currency: string };
export interface Gateway {
  getOrder(id: string): Promise<GatewayOrder | null>;
  createOrder(order: Record<string, unknown>, key: string): Promise<GatewayOrder>;
  payments(id: string): Promise<GatewayPayment[]>;
}

// Deliberately sandbox-only. No environment variable can switch this to production.
export class CashfreeClient implements Gateway {
  private readonly base = 'https://sandbox.cashfree.com/pg';
  private async request(path: string, method = 'GET', body?: unknown, key?: string): Promise<any> {
    const id = process.env.CASHFREE_CLIENT_ID;
    const secret = process.env.CASHFREE_CLIENT_SECRET;
    if (!id || !secret) throw new ServiceUnavailableException('Configure Cashfree sandbox credentials in .env');
    try {
      const response = await fetch(`${this.base}${path}`, {
        method, signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', 'x-client-id': id, 'x-client-secret': secret,
          'x-api-version': process.env.CASHFREE_API_VERSION ?? '2026-01-01', ...(key ? { 'x-idempotency-key': key } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (method === 'GET' && response.status === 404) return null;
      if (!response.ok) throw new Error(`Gateway HTTP ${response.status}`);
      return await response.json();
    } catch { throw new ServiceUnavailableException('Cashfree unavailable or rejected the request; retry with the same idempotency key'); }
  }
  getOrder(id: string): Promise<GatewayOrder | null> { return this.request(`/orders/${encodeURIComponent(id)}`); }
  createOrder(order: Record<string, unknown>, key: string): Promise<GatewayOrder> { return this.request('/orders', 'POST', order, key); }
  async payments(id: string): Promise<GatewayPayment[]> {
    const result = await this.request(`/orders/${encodeURIComponent(id)}/payments`);
    if (!Array.isArray(result)) throw new ServiceUnavailableException('Cashfree payments response unavailable');
    return result;
  }
}

export function verifySignature(body: Buffer, signature: string, timestamp: string, secret: string): boolean {
  if (!signature || !timestamp || !secret || !/^\d+$/.test(timestamp)) return false;
  const expected = createHmac('sha256', secret).update(timestamp).update(body).digest('base64');
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, Buffer.from(expected));
}

export function toMinor(value: number | string): number {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Invalid monetary amount');
  const [whole, fraction = ''] = text.split('.');
  const minor = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
  if (!Number.isSafeInteger(minor)) throw new Error('Amount exceeds safe range');
  return minor;
}
