import { Controller, Get, Param, Req, Inject, NotFoundException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';

/**
 * The controller is NOT where the bug lives.
 *
 * That is the point of the spike: a naive correlation would stop at the
 * handler the route resolves to. The code map has to walk one hop further,
 * into InvoiceService.find, or the finding points at the wrong line and the
 * remediation advice is useless.
 */
@Controller('api/invoices')
export class InvoiceController {
  // @Inject is explicit because the spike runs under tsx/esbuild, which does
  // not emit `design:paramtypes`. Real Nest apps compiled by tsc can rely on
  // implicit metadata. This is a runner artifact, not a design choice — and
  // it does not affect the code map, which resolves DI from the declared
  // parameter TYPE syntactically, not from runtime metadata.
  constructor(@Inject(InvoiceService) private readonly invoiceService: InvoiceService) {}

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    const requesterId = req.userId;
    const invoice = await this.invoiceService.find(id, requesterId);
    if (!invoice) {
      throw new NotFoundException();
    }
    return invoice;
  }

  @Get()
  async list(@Req() req: any) {
    return { ownerId: req.userId };
  }
}
