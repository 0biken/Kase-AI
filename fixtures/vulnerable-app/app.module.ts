import { Module, MiddlewareConsumer, NestModule, Injectable, NestMiddleware } from '@nestjs/common';
import { InvoiceController } from './invoices/invoice.controller';
import { InvoiceService } from './invoices/invoice.service';
import { HealthController } from './health.controller';
import { prisma } from './db';

/**
 * Resolves `Authorization: Bearer <token>` to a user id.
 * Authentication works correctly here — the vulnerability is authorization,
 * one layer deeper. The caller is always who they claim to be.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  async use(req: any, res: any, next: () => void) {
    const header: string = req.headers?.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      const user = await prisma.user.findByToken(token);
      if (user) req.userId = user.id;
    }
    if (!req.userId) {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'unauthenticated' }));
      return;
    }
    next();
  }
}

@Module({
  controllers: [InvoiceController, HealthController],
  providers: [InvoiceService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('api/invoices');
  }
}
