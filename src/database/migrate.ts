import 'dotenv/config';
import { Pool } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(732104)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
    for (const name of (await readdir('migrations')).filter(n => n.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT name FROM schema_migrations WHERE name=$1', [name])).rowCount) continue;
      await client.query(await readFile(path.join('migrations', name), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      console.log(`Applied ${name}`);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); await pool.end(); }
}
main().catch(() => { console.error('Migration failed; check database connectivity and migration SQL'); process.exitCode = 1; });
