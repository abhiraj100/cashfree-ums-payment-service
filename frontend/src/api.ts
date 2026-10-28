import type { Attempt, Dashboard, Invoice, PaymentOrder, Receipt } from './types';

const API = '/api/v1';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? message;
    } catch { /* Preserve the safe fallback. */ }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export const api = {
  dashboard: (token: string) => request<Dashboard>('/dashboard', token),
  invoices: (token: string) => request<Invoice[]>('/invoices', token),
  createInvoice: (token: string, body: { erpReference: string; studentReference: string; customerPhone: string; amountMinor: number }) =>
    request<Invoice>('/invoices', token, { method: 'POST', body: JSON.stringify(body) }),
  initiate: (token: string, invoiceId: string, key: string, forceNew = false) => request<PaymentOrder>('/payment-orders', token, {
    method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ invoiceId, ...(forceNew ? { forceNew: true } : {}) }),
  }),
  order: (token: string, id: string) => request<PaymentOrder>(`/payment-orders/${id}`, token),
  verify: (token: string, id: string) => request<PaymentOrder>(`/payment-orders/${id}/verify`, token, { method: 'POST' }),
  attempts: (token: string, id: string) => request<Attempt[]>(`/payment-orders/${id}/attempts`, token),
  receipt: (token: string, invoiceId: string) => request<Receipt>(`/invoices/${invoiceId}/receipt`, token),
  exceptions: (token: string) => request<Array<Record<string, unknown>>>('/operations/exceptions', token),
  sync: (token: string) => request<Array<Record<string, unknown>>>('/operations/erp-sync', token),
};
