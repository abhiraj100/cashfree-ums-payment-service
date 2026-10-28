# Cashfree UMS Payment Service

Full-stack technical assessment implementation: a responsive university fee collection portal and a reliable backend for full INR payments through **Cashfree Sandbox only**. No real funds, paid database hosting, Redis, or paid API subscription is needed for the local demonstration. Cashfree sandbox access requires your own Cashfree test account and test API credentials. This repository does not create an account or supply credentials.

Stack: React, Vite, TypeScript, NestJS, PostgreSQL, parameterized SQL, Cashfree REST and Checkout APIs, durable database inbox/outbox, Vitest, Supertest, and Docker Compose. Direct REST requests keep the server integration small and make the pinned API version explicit; no SDK subscription is involved. Cashfree's documented API version default was `2026-01-01` when checked on 28 October 2026. API and dashboard webhook versions are separate settings.

## Install and run — Windows PowerShell

Prerequisites: Node.js 22+ (Node 24 LTS recommended), npm, and either Docker Desktop with Compose or a local PostgreSQL 17 server. The software used here is available without a paid cloud service; check Docker Desktop licensing if using it within a larger organization. Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`; changing execution policy is unnecessary.

On Windows, the simplest no-admin option is the project-local PostgreSQL distribution:

```powershell
npm.cmd install
npm.cmd run setup:portable
npm.cmd run dev:ready
```

`setup:portable` downloads PostgreSQL 17.11 from EDB, verifies EDB's published SHA-256, initializes `.local/pgdata`, creates the application database, runs migrations, seeds the demo invoice, and builds both applications. `.local` is ignored by Git. Stop the database later with `npm.cmd run db:portable:stop`.

```powershell
cd C:\Users\omup1\OneDrive\Desktop\cashfree-ums-payment-service
Copy-Item .env.example .env
npm.cmd ci
```

Edit `.env`: set a new `ERP_API_TOKEN` of at least 24 characters. Leave Cashfree credentials empty until you obtain sandbox keys. Do not commit `.env`.

Validate the configuration without printing any secret values:

```powershell
npm.cmd run check:env
```

### Option A: PostgreSQL in Docker; API and worker on your computer

```powershell
docker compose up -d db
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run build
npm.cmd run dev
```

In a second terminal in this folder:

```powershell
npm.cmd run worker:dev
```

Payment portal: <http://localhost:3000>. API documentation: <http://localhost:3000/docs>. Health: <http://localhost:3000/health/ready>. Sign in to the portal with the `ERP_API_TOKEN` from `.env`. It is kept in browser `sessionStorage`, so closing the tab clears it. Seeding creates invoice `11111111-1111-4111-8111-111111111111` for INR 100.00 and is safe to repeat.

`npm.cmd run build` compiles both the backend and frontend. `dev` watches backend files and serves the latest compiled frontend. For live frontend editing, use three terminals:

```powershell
# Terminal 1
npm.cmd run dev

# Terminal 2 - open http://localhost:5173
npm.cmd run dev:web

# Terminal 3
npm.cmd run worker:dev
```

The Vite development server proxies API requests to port 3000. For the production-style local run, use `npm.cmd run build`, `npm.cmd start`, and `npm.cmd run worker`; both UI and API are then served from port 3000.

After PostgreSQL is running and `npm.cmd run setup:local` succeeds, you can also launch the API, frontend dev server, and worker together:

```powershell
npm.cmd run dev:all
```

### Option B: Everything in Docker

After configuring `.env`:

```powershell
docker compose up --build -d
docker compose exec api npm run db:seed
docker compose logs -f api worker
```

API and worker each run the versioned migrations at startup; an advisory transaction lock serializes migration runners. Stop containers with `docker compose down`. This preserves database records in the named volume.

### Option C: No Docker

Install PostgreSQL 17 using its official Windows installer. In pgAdmin or `psql` as the PostgreSQL administrator, run the following statements separately (CREATE DATABASE cannot run inside a transaction):

```sql
CREATE USER ums WITH PASSWORD 'ums_local_password';
CREATE DATABASE ums_payments OWNER ums;
```

Set `DATABASE_URL` in `.env` to your database connection string. Then run `db:migrate`, `db:seed`, `dev`, and `worker:dev` as above. Use a different local password if appropriate and URL-encode special password characters in the connection string.

The repository also includes a repeatable `psql` setup script:

```powershell
psql -U postgres -f scripts/create-local-db.sql
npm.cmd run setup:local
npm.cmd run dev:all
```

## Configure Cashfree's test environment

1. Sign into [Cashfree's Merchant Dashboard](https://merchant.cashfree.com/) and select its **test/sandbox environment**. Open **Developers -> API Keys -> Payment Gateway**, then generate or reveal the test client ID and secret. Do not use Payouts, Secure ID, or production credentials. If a secret has been posted in chat, logs, or screenshots, rotate it before continuing.
2. Put those values in `.env` as `CASHFREE_CLIENT_ID` and `CASHFREE_CLIENT_SECRET`. Keep `CASHFREE_API_VERSION=2026-01-01` unless you deliberately implement and test a different supported API contract.
3. Expose port 3000 through an HTTPS development tunnel of your choice. The tunnel must support webhooks. Set `PUBLIC_BASE_URL` to its HTTPS origin, with no trailing slash. A public deployment you already control also works. You do not need a paid tunnel plan for the basic workflow if your chosen provider offers a suitable free tier.
4. In the Cashfree test dashboard, register `https://YOUR-PUBLIC-ORIGIN/api/v1/webhooks/cashfree`. Subscribe to payment success, payment failure, and user dropped events. Choose a documented webhook version supported by your account and compare its payload to the fixtures in `test/payments.test.ts`.
5. Restart API and worker after editing `.env`.
6. Open the payment portal, select an unpaid invoice, and click **Pay securely in sandbox**. The React frontend creates the order through the authenticated backend and opens Cashfree's hosted checkout in sandbox mode. The token is entered at runtime and is never built into the JavaScript bundle.
7. Use only the test cards/UPI identifiers in [Cashfree's sandbox guide](https://www.cashfree.com/docs/payments/online/resources/sandbox-environment). Follow any domain registration requirements shown by your test dashboard. The optional checkout example loads Cashfree's JavaScript from its official CDN.

If the project-local Cloudflare utility is present, start a temporary tunnel after the API is running:

```powershell
npm.cmd run tunnel
```

Copy the printed `https://...trycloudflare.com` origin into `PUBLIC_BASE_URL`, register the webhook URL in Cashfree, then restart the API and worker. Quick-tunnel URLs can change whenever the tunnel restarts, so update both places when that happens.

### Where every `.env` value comes from

| Variable | Source |
| --- | --- |
| `PORT` | Your local choice; this project uses `3000` |
| `DATABASE_URL` | The PostgreSQL user, password, port, and database created by `compose.yaml` or manually in PostgreSQL |
| `ERP_API_TOKEN` | A random value you generate locally; it is not supplied by Cashfree |
| `CASHFREE_CLIENT_ID` | Cashfree Merchant Dashboard, test environment, Payment Gateway API keys |
| `CASHFREE_CLIENT_SECRET` | Same Cashfree test API-key screen; rotate it after any accidental disclosure |
| `CASHFREE_API_VERSION` | Pinned Cashfree Orders API contract; currently `2026-01-01` in this implementation |
| `PUBLIC_BASE_URL` | The HTTPS origin printed by your tunnel, with no trailing slash |
| `WORKER_INTERVAL_MS` | Local worker setting; keep `10000` for the assessment |
| `ERP_MOCK_FAIL` | Local failure simulation; keep `false` normally |

The backend hard-codes `https://sandbox.cashfree.com/pg`, and the frontend initializes Cashfree Checkout with `mode: 'sandbox'`. There is no switch to live payments. The `/payment-return` endpoint redirects to the portal, which asks the backend to verify the saved order; the redirect itself never marks an invoice paid.

## Manual API walkthrough

Open a new PowerShell terminal. Substitute the token you configured in `.env`:

```powershell
$base = 'http://localhost:3000'
$headers = @{ Authorization = 'Bearer YOUR_ERP_API_TOKEN' }

# Create a fresh invoice; amountMinor is integer paise: 10000 = INR 100.
$invoiceBody = @{
  erpReference = 'SEM-' + [guid]::NewGuid().ToString()
  studentReference = 'STUDENT-001'
  customerPhone = '9999999999'
  amountMinor = 10000
} | ConvertTo-Json
$invoice = Invoke-RestMethod -Method Post -Uri "$base/api/v1/invoices" -Headers $headers -ContentType 'application/json' -Body $invoiceBody

# Keep this key and body unchanged when retrying.
$orderHeaders = @{ Authorization = $headers.Authorization; 'Idempotency-Key' = [guid]::NewGuid().ToString() }
$orderBody = @{ invoiceId = $invoice.id } | ConvertTo-Json
$order = Invoke-RestMethod -Method Post -Uri "$base/api/v1/payment-orders" -Headers $orderHeaders -ContentType 'application/json' -Body $orderBody
$order

# Repeat: should return the same local order and payment session.
Invoke-RestMethod -Method Post -Uri "$base/api/v1/payment-orders" -Headers $orderHeaders -ContentType 'application/json' -Body $orderBody

# Complete sandbox checkout with $order.payment_session_id, then verify.
Invoke-RestMethod -Method Post -Uri "$base/api/v1/payment-orders/$($order.id)/verify" -Headers $headers
Invoke-RestMethod -Uri "$base/api/v1/payment-orders/$($order.id)/attempts" -Headers $headers
Invoke-RestMethod -Uri "$base/api/v1/invoices/$($invoice.id)" -Headers $headers
Invoke-RestMethod -Uri "$base/api/v1/invoices/$($invoice.id)/receipt" -Headers $headers
Invoke-RestMethod -Uri "$base/api/v1/operations/erp-sync" -Headers $headers
Invoke-RestMethod -Uri "$base/api/v1/operations/exceptions" -Headers $headers
```

The last receipt request returns 404 until a successful payment is finalized. PostgreSQL `BIGINT` amounts are returned as JSON strings in database-backed responses to avoid precision loss; input amounts are validated safe integers.

## API reference

All `/api/v1` business/operations routes require `Authorization: Bearer <ERP_API_TOKEN>`. The webhook instead requires Cashfree's signature and timestamp headers. Swagger at `/docs` documents request schemas and supports the bearer token using **Authorize**. `/docs-json` supplies OpenAPI JSON. Import `postman/cashfree-ums.postman_collection.json` for an alternative client.

| Method | Path | Result |
| --- | --- | --- |
| POST | `/api/v1/invoices` | Create invoice from trusted ERP data; unique ERP reference |
| GET | `/api/v1/invoices` | List the latest 100 invoices with order and receipt summary |
| GET | `/api/v1/dashboard` | Collection totals and payment-attempt summary |
| GET | `/api/v1/invoices/:id` | Invoice status |
| GET | `/api/v1/invoices/:id/receipt` | Single receipt or 404 |
| POST | `/api/v1/payment-orders` | `{ "invoiceId": "uuid" }`; `Idempotency-Key` required |
| GET | `/api/v1/payment-orders/:id` | Local order and checkout session |
| GET | `/api/v1/payment-orders/:id/attempts` | Payment attempt history |
| POST | `/api/v1/payment-orders/:id/verify` | Fetch gateway order/attempts and reconcile |
| POST | `/api/v1/webhooks/cashfree` | Signed raw JSON payload; durable acknowledgement |
| GET | `/api/v1/operations/exceptions` | Most recent 100 financial exceptions |
| GET | `/api/v1/operations/erp-sync` | Up to 100 ERP delivery states |
| GET | `/health/live`, `/health/ready` | Process/database health |

Typical statuses: 400 invalid input, 401 missing/invalid authentication or webhook signature, 404 unknown resource, 409 conflicting key/reference or already-paid invoice, 503 unavailable/unconfigured gateway. Transient order creation failures keep the local reservation: retry the original key.

The token represents **one trusted ERP service**, not individual students. All callers holding that token can access that ERP's invoices. For a student-facing deployment, the ERP must enforce student ownership before forwarding requests; add tenant/principal scoping and per-principal key uniqueness if serving multiple ERPs. This assessment does not implement a login platform.

## Automated testing

No Cashfree account or database installation is needed for the default test suite:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Default tests use an in-memory PostgreSQL emulator, the real SQL schema, a fake gateway, and Nest HTTP requests. They cover raw webhook byte verification, unauthorized requests, DTO validation, duplicate initiation, key conflicts, pending-to-success, failure/abandonment, late failures, duplicate successes, amount/currency mismatches, unknown orders, additional success detection, timeout recovery, and missing-webhook reconciliation. They do **not** prove PostgreSQL row-lock or rollback semantics; run the real database suite below for those.

### Real PostgreSQL tests

Use a separate disposable database. The tests create and remove an isolated schema; do not use production credentials. With the local Docker database, its `ums_payments` database can host the temporary test schema:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://ums:ums_local_password@localhost:55432/ums_payments'
npm.cmd test
Remove-Item Env:TEST_DATABASE_URL
```

Without `TEST_DATABASE_URL`, those tests are explicitly skipped. They exercise concurrent requests and confirmations, transaction rollback, worker inbox/outbox processing, and ERP failure recovery on actual PostgreSQL. Keep the test account authorized to create schemas.

### Sandbox acceptance checklist

1. Health returns 200 and Swagger opens.
2. Initiate an INR 100 invoice; repeat the same key and verify identical order IDs. A different key for the same still-active invoice also reuses the order.
3. Reuse the key for another invoice: expect 409.
4. Complete a successful test checkout; invoice becomes `PAID`, one receipt exists, and ERP outbox becomes `DONE` with worker running.
5. Use test failure/cancellation flows from Cashfree. Invoice remains `UNPAID`; attempt shows gateway outcome. Closing the browser alone does not imply a cancelled invoice.
6. Replay a success notification from the test dashboard. Receipt count stays one.
7. Stop the worker before payment, then restart. Stored events process after restart.
8. Disable webhook delivery temporarily and complete another sandbox payment. The worker or explicit verify API recovers it using gateway lookups.
9. Set `ERP_MOCK_FAIL=true`, restart worker, complete a payment. Invoice stays paid while ERP event retries. Set it to `false` and restart: ERP event eventually becomes `DONE`.
10. Inspect exception and ERP-sync endpoints. A second confirmed payment is recorded for review, never converted into a second fee receipt.

After ten unsuccessful processing attempts, inbox/outbox events become `DEAD`. Fix the underlying cause, then deliberately requeue the relevant ID through SQL (see [operations](docs/architecture.md)); no event is deleted. Dashboard replay is also suitable for sandbox investigation.

## Design and limits

See [architecture and database design](docs/architecture.md) for transaction boundaries, schema, recovery, security, and operational queries.

Scope: full INR invoice payments, one trusted ERP, locally persisted mock ERP delivery. Receipts act as the unique full-payment allocation. No partial payments, refunds, settlement ledger, live gateway mode, automatic refunds, multi-tenancy, or real ERP network adapter. Confirmed payments and ERP delivery have separate states. A real external ERP must accept an idempotency key such as the receipt ID to tolerate delivery retries.

Before exposing this assessment beyond a controlled demo, supply real ERP authentication/authorization, edge rate limits, secret management, monitoring/alerting, backups, and a personal-data retention policy. Logs intentionally exclude tokens, query strings, phone numbers, webhook bodies, and gateway responses. Webhook payloads remain in PostgreSQL for diagnosis; restrict database access and set retention for your institution.

## Official integration references

- [Create order](https://www.cashfree.com/docs/api-reference/payments/latest/orders/create-order)
- [Get order](https://www.cashfree.com/docs/api-reference/payments/latest/orders/get-order)
- [Get payments for an order](https://www.cashfree.com/docs/api-reference/payments/latest/payments/get-payments-for-an-order)
- [Webhook signature verification](https://www.cashfree.com/docs/payments/online/webhooks/signature-verification)
- [Webhook idempotency](https://www.cashfree.com/docs/payments/online/webhooks/webhook-indempotency)
- [Sandbox test instruments](https://www.cashfree.com/docs/payments/online/resources/sandbox-environment)

Use the dashboard and these current references if Cashfree changes account setup, version availability, or test instruments.
