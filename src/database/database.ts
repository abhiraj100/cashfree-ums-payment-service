import { Pool, PoolClient } from 'pg';

export class Database {
  constructor(readonly pool: Pool) {}
  query(text: string, values: unknown[] = []) { return this.pool.query(text, values); }
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}
