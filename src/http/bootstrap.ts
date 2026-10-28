import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

export function configureApp(app: INestApplication) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://sdk.cashfree.com'],
        frameSrc: ["'self'", 'https://*.cashfree.com'],
        connectSrc: ["'self'", 'https://*.cashfree.com'],
        imgSrc: ["'self'", 'data:', 'https://*.cashfree.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    res.setHeader('Cache-Control', 'no-store');
    const started = Date.now();
    res.on('finish', () => console.log(JSON.stringify({ requestId: id, method: req.method, status: res.statusCode, durationMs: Date.now() - started })));
    next();
  });
  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('UMS Cashfree Sandbox Payments').setVersion('1.0.0')
    .setDescription('Full-stack UMS fee payment portal using Cashfree Sandbox. All business endpoints require the trusted ERP bearer token.')
    .addBearerAuth().build());
  SwaggerModule.setup('docs', app, document);
}
