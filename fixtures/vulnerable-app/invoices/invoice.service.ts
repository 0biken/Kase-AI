import { Injectable } from '@nestjs/common';
import { prisma, Invoice } from '../db';

@Injectable()
export class InvoiceService {
  /**
   * SEEDED VULNERABILITY (IDOR).
   *
   * The lookup is keyed on the record id alone. `requesterId` is accepted
   * but never constrains the query, so any authenticated caller can read
   * any invoice by guessing or enumerating an id.
   *
   * This is the exact line the correlation path must arrive at, starting
   * from an externally observed 200 response on GET /api/invoices/:id.
   */
  async find(id: string, requesterId: string): Promise<Invoice | null> {
    return prisma.invoice.findUnique({ where: { id } });
  }

  /**
   * The fixed form, used by `--fixed` to prove the finding clears.
   * Ownership is part of the query predicate, so a non-owner gets null.
   */
  async findScoped(id: string, requesterId: string): Promise<Invoice | null> {
    return prisma.invoice.findFirst({ where: { id, ownerId: requesterId } });
  }
}
