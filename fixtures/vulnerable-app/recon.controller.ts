import { Controller, Get, Header, Redirect, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

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
    const slowVerify = process.env.FIXTURE_SLOW_HTTPX === 'true' ? '<a href="/slow-verify">slow verify</a>' : '';
    return `<!doctype html><html><body>
      <a href="/api/invoices/123">invoice</a>
      <a href="/api/invoices/456/?q=duplicate&page=2">invoice duplicate</a>
      ${versioned}
      ${slow}
      ${slowVerify}
      <a href="/recon-stable">stable metadata</a>
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

  @Get('recon-stable')
  stable(@Res() response: Response) {
    if (process.env.FIXTURE_RECON_VERSION === '3') return response.type('text/plain').send('changed metadata');
    return response.type('application/json').send({ stable: true });
  }

  @Get('slow-crawl')
  async slowCrawl() {
    await waitForProofDelay();
    return 'slow';
  }

  @Get('slow-verify')
  async slowVerify(@Req() request: Request) {
    if (/httpx/iu.test(request.headers['user-agent'] ?? '')) await waitForProofDelay();
    return { verified: true };
  }
}

async function waitForProofDelay(): Promise<void> {
  const configured = Number(process.env.FIXTURE_SLOW_MS ?? 120_000);
  await new Promise((resolve) => setTimeout(resolve, Number.isSafeInteger(configured) && configured > 0 ? configured : 120_000));
}
