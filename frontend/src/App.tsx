import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from './api';
import type { Attempt, Dashboard, Invoice, PaymentOrder, Receipt } from './types';

const TOKEN_KEY = 'ums_erp_token';
const LAST_ORDER_KEY = 'ums_last_payment_order';

const icons = {
  grid: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6M9 16h4" />,
  activity: <path d="M3 12h4l2-6 4 12 2-6h6" />,
  help: <path d="M9.1 9a3 3 0 1 1 5.2 2c-1.3 1.3-2.3 1.8-2.3 3M12 18h.01" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <path d="M20 6v5h-5M4 18v-5h5M18.7 9A7 7 0 0 0 6.2 6.2L4 11m16 2-2.2 4.8A7 7 0 0 1 5.3 15" />,
  shield: <path d="M12 3 20 7v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7l8-4Zm-3 9 2 2 4-5" />,
  logout: <path d="M10 17l5-5-5-5M15 12H3M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  card: <path d="M3 6h18v12H3zM3 10h18M7 15h3" />,
};

function Icon({ name, size = 20 }: { name: keyof typeof icons; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

const money = (minor: string | number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(minor) / 100);
const date = (value: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function Login({ onLogin }: { onLogin: (token: string) => Promise<void> }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try { await onLogin(token.trim()); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-story">
      <div className="university-mark"><span>N</span></div>
      <div>
        <p className="eyebrow">Northstar University</p>
        <h1>Fee collection that stays in step with your ERP.</h1>
        <p className="login-copy">A secure sandbox workspace for creating student invoices, collecting payments through Cashfree, and reconciling every attempt.</p>
      </div>
      <div className="trust-note"><Icon name="shield" /><span>Cashfree sandbox · No real money is transferred</span></div>
    </section>
    <section className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow dark">ERP access</p>
        <h2>Welcome back</h2>
        <p>Enter the ERP API token from your local <code>.env</code> file.</p>
        <label>ERP API token<input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Paste your local token" autoFocus required /></label>
        {error && <div className="alert error" role="alert">{error}</div>}
        <button className="primary wide" disabled={busy || token.length < 24}>{busy ? 'Checking access…' : 'Open payment console'}</button>
        <small>The token is stored only in this browser tab and is never included in the frontend build.</small>
      </form>
    </section>
  </main>;
}

function NewInvoice({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ erpReference: `SEM-${new Date().getFullYear()}-`, studentReference: '', customerPhone: '', amount: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const rupees = Number(form.amount);
    if (!Number.isFinite(rupees) || rupees < 1 || Math.round(rupees * 100) !== rupees * 100) { setError('Enter an amount of at least ₹1 with no more than two decimals.'); setBusy(false); return; }
    try {
      await api.createInvoice(token, { erpReference: form.erpReference.trim(), studentReference: form.studentReference.trim(), customerPhone: form.customerPhone.trim(), amountMinor: Math.round(rupees * 100) });
      onCreated();
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-invoice-title">
      <button className="icon-button modal-close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      <p className="eyebrow dark">New fee demand</p><h2 id="new-invoice-title">Create student invoice</h2>
      <form onSubmit={submit} className="form-grid">
        <label className="span-2">ERP reference<input value={form.erpReference} onChange={e => setForm({ ...form, erpReference: e.target.value })} maxLength={100} required /></label>
        <label>Student reference<input value={form.studentReference} onChange={e => setForm({ ...form, studentReference: e.target.value })} placeholder="STUDENT-001" pattern="[A-Za-z0-9_-]+" required /></label>
        <label>Student phone<input value={form.customerPhone} onChange={e => setForm({ ...form, customerPhone: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="9999999999" inputMode="numeric" pattern="[6-9][0-9]{9}" required /></label>
        <label className="span-2">Amount in rupees<div className="money-input"><span>₹</span><input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="100.00" inputMode="decimal" required /></div></label>
        {error && <div className="alert error span-2" role="alert">{error}</div>}
        <div className="modal-actions span-2"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create invoice'}</button></div>
      </form>
    </section>
  </div>;
}

function InvoiceDrawer({ invoice, token, onClose, onUpdated, toast }: { invoice: Invoice; token: string; onClose: () => void; onUpdated: () => Promise<void>; toast: (text: string, kind?: 'success' | 'error') => void }) {
  const [busy, setBusy] = useState('');
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const loadDetails = useCallback(async () => {
    if (invoice.payment_order_id) {
      const [found, history] = await Promise.all([api.order(token, invoice.payment_order_id), api.attempts(token, invoice.payment_order_id)]);
      setOrder(found); setAttempts(history);
    }
    if (invoice.status === 'PAID') { try { setReceipt(await api.receipt(token, invoice.id)); } catch { /* Eventual refresh. */ } }
  }, [invoice, token]);
  useEffect(() => { void loadDetails(); }, [loadDetails]);

  async function verify(orderId: string) {
    setBusy('verify');
    try { await api.verify(token, orderId); await onUpdated(); await loadDetails(); toast('Payment status reconciled with Cashfree.', 'success'); }
    catch (e) { toast(messageOf(e), 'error'); } finally { setBusy(''); }
  }

  async function pay() {
    setBusy('pay');
    try {
      const idempotencyKey = crypto.randomUUID();
      const created = await api.initiate(token, invoice.id, idempotencyKey);
      sessionStorage.setItem(LAST_ORDER_KEY, created.id);
      setOrder(created);
      if (!created.payment_session_id) throw new Error('Cashfree did not return a payment session. Use Verify status and try again.');
      if (!window.Cashfree) throw new Error('Cashfree Checkout could not load. Check your internet connection and content-security settings.');
      await window.Cashfree({ mode: 'sandbox' }).checkout({ paymentSessionId: created.payment_session_id, redirectTarget: '_modal' });
      toast('Checkout closed. Confirming the server-side payment status…');
      await verify(created.id);
    } catch (e) { toast(messageOf(e), 'error'); } finally { setBusy(''); }
  }

  return <div className="drawer-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Invoice ${invoice.erp_reference}`}>
      <div className="drawer-head"><div><p className="eyebrow dark">Invoice detail</p><h2>{invoice.erp_reference}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
      <div className="invoice-hero"><div><span>Amount due</span><strong>{money(invoice.amount_minor)}</strong></div><span className={`status ${invoice.status.toLowerCase()}`}>{invoice.status}</span></div>
      <dl className="detail-list"><div><dt>Student</dt><dd>{invoice.student_reference}</dd></div><div><dt>Phone</dt><dd>••••••{invoice.customer_phone.slice(-4)}</dd></div><div><dt>Created</dt><dd>{date(invoice.created_at)}</dd></div><div><dt>Currency</dt><dd>{invoice.currency}</dd></div></dl>
      {invoice.status === 'UNPAID' && <button className="primary wide pay-button" onClick={pay} disabled={!!busy}><Icon name="card" />{busy === 'pay' ? 'Opening Cashfree…' : 'Pay securely in sandbox'}</button>}
      {order && <section className="drawer-section"><div className="section-title"><h3>Payment order</h3><button className="text-button" disabled={!!busy} onClick={() => verify(order.id)}><Icon name="refresh" size={16} />{busy === 'verify' ? 'Checking…' : 'Verify status'}</button></div><div className="order-strip"><span>{order.merchant_order_id}</span><b>{order.status}</b></div></section>}
      <section className="drawer-section"><h3>Attempt history</h3>{attempts.length ? <div className="timeline">{attempts.map(item => <div className="timeline-row" key={item.cf_payment_id}><i className={item.status === 'SUCCESS' ? 'success-dot' : ''} /><div><strong>{item.status}</strong><span>{item.cf_payment_id}</span></div><time>{date(item.updated_at)}</time></div>)}</div> : <p className="empty-small">No payment attempt has reached the server yet.</p>}</section>
      {receipt && <section className="receipt-card"><div className="receipt-icon"><Icon name="receipt" /></div><div><span>Receipt issued</span><strong>{receipt.id}</strong><small>Cashfree payment {receipt.cf_payment_id}</small></div><b>{money(receipt.amount_minor)}</b></section>}
    </aside>
  </div>;
}

export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [newInvoice, setNewInvoice] = useState(false);
  const [view, setView] = useState<'overview' | 'operations'>('overview');
  const [operations, setOperations] = useState<{ exceptions: Array<Record<string, unknown>>; sync: Array<Record<string, unknown>> }>({ exceptions: [], sync: [] });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ text: string; kind: 'success' | 'error' | 'info' } | null>(null);

  const toast = useCallback((text: string, kind: 'success' | 'error' = 'success') => {
    setNotice({ text, kind }); window.setTimeout(() => setNotice(null), 5000);
  }, []);

  const refresh = useCallback(async (auth = token) => {
    const [summary, list] = await Promise.all([api.dashboard(auth), api.invoices(auth)]);
    setDashboard(summary); setInvoices(list);
    setSelected(current => current ? list.find(item => item.id === current.id) ?? null : null);
  }, [token]);

  const login = useCallback(async (auth: string) => {
    if (auth.length < 24) throw new Error('The ERP token must be at least 24 characters.');
    await refresh(auth); sessionStorage.setItem(TOKEN_KEY, auth); setToken(auth); setLoading(false);
  }, [refresh]);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    refresh(token).catch(error => { if (error instanceof ApiError && error.status === 401) { sessionStorage.removeItem(TOKEN_KEY); setToken(''); } else toast(messageOf(error), 'error'); }).finally(() => setLoading(false));
  }, []); // Restore the session once.

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const lastOrder = sessionStorage.getItem(LAST_ORDER_KEY);
    if (token && params.get('payment_return') === '1' && lastOrder) {
      history.replaceState({}, '', '/');
      api.verify(token, lastOrder).then(() => refresh()).then(() => toast('Payment return received and verified.', 'success')).catch(error => toast(messageOf(error), 'error'));
    }
  }, [token, refresh, toast]);

  async function loadOperations() {
    setView('operations');
    try { const [exceptions, sync] = await Promise.all([api.exceptions(token), api.sync(token)]); setOperations({ exceptions, sync }); }
    catch (e) { toast(messageOf(e), 'error'); }
  }

  const collectionRate = useMemo(() => dashboard?.total_invoices ? Math.round((dashboard.paid_invoices / dashboard.total_invoices) * 100) : 0, [dashboard]);
  if (loading) return <div className="boot"><div className="spinner" /><span>Preparing payment console…</span></div>;
  if (!token) return <Login onLogin={login} />;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="university-mark small"><span>N</span></div><div><strong>Northstar</strong><span>University ERP</span></div></div>
      <nav aria-label="Main navigation">
        <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}><Icon name="grid" />Overview</button>
        <button className={view === 'operations' ? 'active' : ''} onClick={loadOperations}><Icon name="activity" />Operations</button>
        <a href="/docs" target="_blank"><Icon name="help" />API docs</a>
      </nav>
      <div className="sidebar-foot"><div className="sandbox-pill"><i />Sandbox environment</div><button onClick={() => { sessionStorage.clear(); setToken(''); }}><Icon name="logout" />Sign out</button></div>
    </aside>
    <main className="content">
      <header className="topbar"><div><p className="eyebrow dark">Payments workspace</p><h1>{view === 'overview' ? 'Fee collection overview' : 'Operations & reconciliation'}</h1></div><div className="top-actions"><button className="icon-button" aria-label="Refresh" onClick={() => refresh().catch(e => toast(messageOf(e), 'error'))}><Icon name="refresh" /></button>{view === 'overview' && <button className="primary" onClick={() => setNewInvoice(true)}><Icon name="plus" />New invoice</button>}</div></header>
      {view === 'overview' && <>
        <section className="metrics" aria-label="Payment summary">
          <article><span>Collected</span><strong>{money(dashboard?.collected_minor ?? 0)}</strong><small><i className="positive" />{dashboard?.paid_invoices ?? 0} paid invoices</small></article>
          <article><span>Outstanding</span><strong>{money(dashboard?.outstanding_minor ?? 0)}</strong><small>{dashboard?.unpaid_invoices ?? 0} awaiting payment</small></article>
          <article><span>Collection rate</span><strong>{collectionRate}%</strong><div className="progress"><i style={{ width: `${collectionRate}%` }} /></div></article>
          <article><span>Payment attempts</span><strong>{dashboard?.total_attempts ?? 0}</strong><small>{dashboard?.successful_attempts ?? 0} successful</small></article>
        </section>
        <section className="panel invoices-panel">
          <div className="panel-head"><div><h2>Student invoices</h2><p>Latest fee demands and Cashfree payment state</p></div><span>{invoices.length} records</span></div>
          <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Student</th><th>Issued</th><th>Amount</th><th>Status</th><th aria-label="Actions" /></tr></thead><tbody>{invoices.map(invoice => <tr key={invoice.id} onClick={() => setSelected(invoice)}><td><strong>{invoice.erp_reference}</strong><span>{invoice.id.slice(0, 8)}</span></td><td>{invoice.student_reference}</td><td>{date(invoice.created_at)}</td><td className="amount">{money(invoice.amount_minor)}</td><td><span className={`status ${invoice.status.toLowerCase()}`}>{invoice.status}</span></td><td><button className="row-action" onClick={e => { e.stopPropagation(); setSelected(invoice); }}>{invoice.status === 'PAID' ? 'View receipt' : 'Collect'}</button></td></tr>)}</tbody></table>{!invoices.length && <div className="empty-state"><div className="receipt-icon"><Icon name="receipt" /></div><h3>No invoices yet</h3><p>Create the first student fee demand to begin testing.</p><button className="primary" onClick={() => setNewInvoice(true)}><Icon name="plus" />Create invoice</button></div>}</div>
        </section>
      </>}
      {view === 'operations' && <section className="operations-grid">
        <article className="panel"><div className="panel-head"><div><h2>ERP delivery queue</h2><p>Reliable outbox delivery state</p></div><span>{operations.sync.length}</span></div><div className="ops-list">{operations.sync.map((item, index) => <div className="ops-row" key={String(item.id ?? index)}><div><strong>{String(item.state)}</strong><span>Receipt {String(item.receipt_id).slice(0, 12)}…</span></div><small>{String(item.attempts)} attempts</small></div>)}{!operations.sync.length && <p className="empty-small padded">No ERP events have been created.</p>}</div></article>
        <article className="panel"><div className="panel-head"><div><h2>Payment exceptions</h2><p>Items requiring operator review</p></div><span>{operations.exceptions.length}</span></div><div className="ops-list">{operations.exceptions.map((item, index) => <div className="ops-row exception" key={String(item.id ?? index)}><div><strong>{String(item.reason)}</strong><span>{String(item.reference)}</span></div></div>)}{!operations.exceptions.length && <p className="empty-small padded">No payment exceptions. Everything looks clear.</p>}</div></article>
      </section>}
    </main>
    {newInvoice && <NewInvoice token={token} onClose={() => setNewInvoice(false)} onCreated={() => { setNewInvoice(false); refresh().then(() => toast('Invoice created successfully.')).catch(error => toast(messageOf(error), 'error')); }} />}
    {selected && <InvoiceDrawer invoice={selected} token={token} onClose={() => setSelected(null)} onUpdated={refresh} toast={toast} />}
    {notice && <div className={`toast ${notice.kind}`} role="status">{notice.text}</div>}
  </div>;
}
