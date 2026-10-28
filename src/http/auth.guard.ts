import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class ErpAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const value = context.switchToHttp().getRequest().headers.authorization;
    const expected = Buffer.from(`Bearer ${process.env.ERP_API_TOKEN ?? ''}`);
    const actual = Buffer.from(typeof value === 'string' ? value : '');
    if (!process.env.ERP_API_TOKEN || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException('ERP bearer token required');
    }
    return true;
  }
}
