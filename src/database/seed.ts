import 'dotenv/config';
import { Pool } from 'pg';
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`INSERT INTO fee_invoices(id,erp_reference,student_reference,customer_phone,amount_minor)
      VALUES('11111111-1111-4111-8111-111111111111','DEMO-SEM-001','STUDENT-001','9999999999',10000)
      ON CONFLICT (erp_reference) DO NOTHING`);
    console.log('Demo invoice: 11111111-1111-4111-8111-111111111111 (INR 100.00)');
  } finally { await pool.end(); }
}
main().catch(() => { console.error('Seed failed; run migrations first'); process.exitCode = 1; });
