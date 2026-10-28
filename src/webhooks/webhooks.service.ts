import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Database } from '../database/database';
import { verifySignature } from '../cashfree/cashfree.client';

export class WebhooksService {
  constructor(private readonly db: Database) {}
  async accept(raw: Buffer, signature: string, timestamp: string) {
    if (!verifySignature(raw, signature, timestamp, process.env.CASHFREE_CLIENT_SECRET ?? '')) {
      throw new UnauthorizedException('Invalid Cashfree webhook signature');
    }
    let event: any;
    try { event = JSON.parse(raw.toString('utf8')); } catch { throw new BadRequestException('Invalid JSON'); }
    if (!event || typeof event.type !== 'string') throw new BadRequestException('Missing webhook type');
    // Hash the signed bytes, not an unsigned delivery header. Attempt-level transitions
    // remain idempotent even when equivalent payloads have different formatting.
    const hash = createHash('sha256').update(raw).digest('hex');
    await this.db.query(`INSERT INTO webhook_events(id,payload_hash,payload) VALUES($1,$2,$3)
      ON CONFLICT(payload_hash) DO NOTHING`, [randomUUID(), hash, JSON.stringify(event)]);
    return { received: true };
  }
}
