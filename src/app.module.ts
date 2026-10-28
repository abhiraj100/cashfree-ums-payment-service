import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { config } from './config';
import { Database } from './database/database';
import { CashfreeClient } from './cashfree/cashfree.client';
import { PaymentsService } from './payments/payments.service';
import { WebhooksService } from './webhooks/webhooks.service';
import { HealthController, PaymentsController, WebhooksController } from './http/controllers';

@Module({
  controllers: [PaymentsController, WebhooksController, HealthController],
  providers: [
    { provide: Database, useFactory: () => new Database(new Pool({ connectionString: config().databaseUrl, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 30000 })) },
    { provide: PaymentsService, inject: [Database], useFactory: (db: Database) => new PaymentsService(db, new CashfreeClient()) },
    { provide: WebhooksService, inject: [Database], useFactory: (db: Database) => new WebhooksService(db) },
  ],
})
export class AppModule {}
