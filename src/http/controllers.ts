import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, RawBodyRequest, Req, Res, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Database } from '../database/database';
import { PaymentsService } from '../payments/payments.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ErpAuthGuard } from './auth.guard';
import { CreateInvoiceDto, CreateOrderDto } from './dto';

const invoiceValidation = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, expectedType: CreateInvoiceDto });
const orderValidation = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, expectedType: CreateOrderDto });

@ApiTags('ERP payments')
@ApiBearerAuth()
@UseGuards(ErpAuthGuard)
@Controller('api/v1')
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService, @Inject(Database) private readonly db: Database) {}
  @Post('invoices')
  @ApiBody({ type: CreateInvoiceDto })
  createInvoice(@Body(invoiceValidation) body: CreateInvoiceDto) { return this.payments.createInvoice(body); }
  @Get('invoices')
  invoices() { return this.payments.invoices(); }
  @Get('dashboard')
  dashboard() { return this.payments.dashboard(); }
  @Get('invoices/:id')
  invoice(@Param('id', ParseUUIDPipe) id: string) { return this.payments.invoice(id); }
  @Get('invoices/:id/receipt')
  receipt(@Param('id', ParseUUIDPipe) id: string) { return this.payments.receipt(id); }
  @Post('payment-orders')
  @ApiBody({ type: CreateOrderDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '8–128 letters, digits, underscores or hyphens' })
  initiate(@Body(orderValidation) body: CreateOrderDto, @Headers('idempotency-key') key: string) { return this.payments.initiate(body.invoiceId, key); }
  @Get('payment-orders/:id')
  order(@Param('id', ParseUUIDPipe) id: string) { return this.payments.order(id); }
  @Get('payment-orders/:id/attempts')
  attempts(@Param('id', ParseUUIDPipe) id: string) { return this.payments.attempts(id); }
  @Post('payment-orders/:id/verify')
  @HttpCode(200)
  verify(@Param('id', ParseUUIDPipe) id: string) { return this.payments.verify(id); }
  @Get('operations/exceptions')
  async exceptions() { return (await this.db.query('SELECT * FROM payment_exceptions ORDER BY created_at DESC LIMIT 100')).rows; }
  @Get('operations/erp-sync')
  async erpSync() { return (await this.db.query('SELECT id,receipt_id,state,attempts,last_error FROM outbox_events LIMIT 100')).rows; }
}

@ApiTags('Cashfree webhooks')
@Controller('api/v1/webhooks')
export class WebhooksController {
  constructor(@Inject(WebhooksService) private readonly webhooks: WebhooksService) {}
  @Post('cashfree')
  @HttpCode(200)
  accept(@Req() req: RawBodyRequest<Request>, @Headers('x-webhook-signature') signature: string, @Headers('x-webhook-timestamp') timestamp: string) {
    return this.webhooks.accept(req.rawBody ?? Buffer.alloc(0), signature, timestamp);
  }
}

@Controller()
export class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get('health/live') live() { return { status: 'ok', environment: 'sandbox' }; }
  @Get('health/ready') async ready() { await this.db.query('SELECT 1'); return { status: 'ok' }; }
  @Get('payment-return') returned(@Query('order_id') orderId: string | undefined, @Res() response: Response) {
    const query = new URLSearchParams({ payment_return: '1', ...(orderId ? { merchant_order_id: orderId } : {}) });
    return response.redirect(303, `/?${query.toString()}`);
  }
}
