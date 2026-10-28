export type Invoice = {
  id: string;
  erp_reference: string;
  student_reference: string;
  customer_phone: string;
  amount_minor: string | number;
  currency: 'INR';
  status: 'UNPAID' | 'PAID';
  created_at: string;
  payment_order_id?: string | null;
  payment_order_status?: string | null;
  payment_session_id?: string | null;
  receipt_id?: string | null;
  cf_payment_id?: string | null;
};

export type Dashboard = {
  total_invoices: number;
  paid_invoices: number;
  unpaid_invoices: number;
  collected_minor: string | number;
  outstanding_minor: string | number;
  total_attempts: number;
  successful_attempts: number;
  environment: 'sandbox';
};

export type PaymentOrder = {
  id: string;
  invoice_id: string;
  merchant_order_id: string;
  payment_session_id: string | null;
  status: string;
  active: boolean;
};

export type Attempt = {
  cf_payment_id: string;
  status: string;
  amount_minor: string | number;
  currency: string;
  updated_at: string;
};

export type Receipt = {
  id: string;
  invoice_id: string;
  cf_payment_id: string;
  amount_minor: string | number;
  created_at: string;
};

declare global {
  interface Window {
    Cashfree?: (options: { mode: 'sandbox' }) => {
      checkout: (options: { paymentSessionId: string; redirectTarget: '_modal' | '_self' }) => Promise<unknown>;
    };
  }
}
