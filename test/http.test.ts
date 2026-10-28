import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { INestApplication, Module } from '@nestjs/common';
import request from 'supertest';
import { newDb } from 'pg-mem';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { Database } from '../src/database/database';
import { PaymentsService } from '../src/payments/payments.service';
import { WebhooksService } from '../src/webhooks/webhooks.service';
// Exercise emitted legacy decorators/metadata, matching the production runtime.
const { PaymentsController, WebhooksController, HealthController } = require('../dist/http/controllers');
const { configureApp } = require('../dist/http/bootstrap');
const { Database: CompiledDatabase } = require('../dist/database/database');
const { PaymentsService: CompiledPaymentsService } = require('../dist/payments/payments.service');
const { WebhooksService: CompiledWebhooksService } = require('../dist/webhooks/webhooks.service');

describe('HTTP contract', () => {
  let app: INestApplication;
  let db: Database;
  beforeAll(async () => {
    process.env.ERP_API_TOKEN = 'test-erp-token-at-least-24-characters';
    process.env.CASHFREE_CLIENT_SECRET = 'test-secret';
    const memory = newDb();
    memory.public.none(readFileSync('migrations/001_initial.sql', 'utf8'));
    const { Pool } = memory.adapters.createPg();
    db = new Database(new Pool());
    class TestModule {}
    Module({
      controllers: [PaymentsController, WebhooksController, HealthController],
      providers: [
        { provide: CompiledDatabase, useValue: db },
        { provide: CompiledPaymentsService, useValue: new PaymentsService(db, {} as any) },
        { provide: CompiledWebhooksService, useValue: new WebhooksService(db) },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { rawBody: true, logger: false });
    configureApp(app);
    await app.init();
  });
  afterAll(async () => { await app.close(); await db.pool.end(); });
  const auth = () => `Bearer ${process.env.ERP_API_TOKEN}`;
  it('exposes health and OpenAPI documentation', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
    const response = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(response.body.paths['/api/v1/payment-orders']).toBeDefined();
  });
  it('requires authentication', async () => {
    await request(app.getHttpServer()).post('/api/v1/invoices').send({}).expect(401);
  });
  it('rejects invalid amounts and unexpected fields', async () => {
    await request(app.getHttpServer()).post('/api/v1/invoices').set('Authorization', auth())
      .send({ erpReference: 'HTTP-1', studentReference: 'S1', customerPhone: '9999999999', amountMinor: 1.23, extra: true }).expect(400);
  });
  it('creates and retrieves an invoice', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/invoices').set('Authorization', auth())
      .send({ erpReference: 'HTTP-2', studentReference: 'S1', customerPhone: '9999999999', amountMinor: 10000 }).expect(201);
    const invoice = await request(app.getHttpServer()).get(`/api/v1/invoices/${response.body.id}`).set('Authorization', auth()).expect(200);
    expect(invoice.body.status).toBe('UNPAID');
  });
  it('provides the frontend dashboard and invoice list', async () => {
    const dashboard = await request(app.getHttpServer()).get('/api/v1/dashboard').set('Authorization', auth()).expect(200);
    expect(dashboard.body).toMatchObject({ total_invoices: 1, paid_invoices: 0, unpaid_invoices: 1, environment: 'sandbox' });
    const invoices = await request(app.getHttpServer()).get('/api/v1/invoices').set('Authorization', auth()).expect(200);
    expect(invoices.body).toHaveLength(1);
    expect(invoices.body[0].erp_reference).toBe('HTTP-2');
  });
  it('checks UUID parameters', async () => {
    await request(app.getHttpServer()).get('/api/v1/invoices/not-a-uuid').set('Authorization', auth()).expect(400);
  });
  it('verifies raw webhook bytes through the actual JSON middleware', async () => {
    const body = '{ "type": "PAYMENT_SUCCESS_WEBHOOK", "amount": 100.00 }';
    const timestamp = '1793000000000';
    const signature = createHmac('sha256', 'test-secret').update(timestamp).update(body).digest('base64');
    await request(app.getHttpServer()).post('/api/v1/webhooks/cashfree').set('Content-Type', 'application/json')
      .set('x-webhook-signature', signature).set('x-webhook-timestamp', timestamp).send(body).expect(200);
    await request(app.getHttpServer()).post('/api/v1/webhooks/cashfree').send({ type: 'FAKE' }).expect(401);
  });
});
