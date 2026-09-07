import { Controller, Get, Header, Redirect, Res } from '@nestjs/common';
import type { Response } from 'express';

@Controller()
export class ReconFixtureController {
  private deniedProbeCount = 0;

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Server', 'kase-fixture')
  index() {
    const version = process.env.FIXTURE_RECON_VERSION ?? '1';
    const versioned = version === '2'
      ? '<a href="/api/reports/789">new report</a>'
      : '<a href="/recon-redirect">allowed redirect</a>';
    const slow = process.env.FIXTURE_SLOW_RECON === 'true' ? '<a href="/slow-crawl">slow crawl</a>' : '';
    return `<!doctype html><html><body>
      <a href="/api/invoices/123">invoice</a>
      <a href="/api/invoices/456/?q=duplicate&page=2">invoice duplicate</a>
      ${versioned}
      ${slow}
      <a href="/admin/secret">denied path</a>
      <a href="http://trap:3000/should-never-be-requested">out of scope</a>
    </body></html>`;
  }

  @Get('recon-redirect')
  @Redirect('/api/invoices/123', 302)
  redirect() { return; }

  @Get('admin/secret')
  deniedTrap(@Res() response: Response) {
    this.deniedProbeCount += 1;
    response.setHeader('X-Kase-Denied-Trap', 'reached');
    response.status(418).send('this path must never be probed');
  }

  @Get('api/reports/:id')
  report() { return { ok: true }; }

  @Get('proof/denied-count')
  deniedCount() { return { count: this.deniedProbeCount }; }

  @Get('slow-crawl')
  async slowCrawl() {
    await new Promise((resolve) => setTimeout(resolve, 120_000));
    return 'slow';
  }
}
