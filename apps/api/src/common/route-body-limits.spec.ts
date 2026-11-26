import { Body, Controller, HttpCode, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { applyRouteBodyLimits } from './route-body-limits';
import { ProblemDetailsFilter } from './problem-details.filter';

@Controller()
class EchoController {
  @Post('audits/:auditId/import/security-audit') @HttpCode(200)
  importRoute(@Body() body: unknown[]) { return { count: body.length }; }

  @Post('audits/:auditId/gate/evaluate') @HttpCode(200)
  otherRoute(@Body() body: unknown[]) { return { count: body.length }; }
}

describe('route body limits (wired as in main.ts)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [EchoController] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    applyRouteBodyLimits(app);
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  // ~600kb: above Express's 100kb default, well under the import route's 10mb.
  const big = Array.from({ length: 6000 }, (_, i) => ({ i, pad: 'x'.repeat(90) }));

  it('accepts a large findings.json on the import route', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/audits/aud_1/import/security-audit').send(big);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 6000 });
  });

  it('leaves normal JSON parsing intact on every other route', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/audits/aud_1/gate/evaluate').send([1, 2, 3]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 3 });
  });

  it('keeps the default limit everywhere else and reports it as 413 problem details', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/audits/aud_1/gate/evaluate').send(big);
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('still bounds the import route', async () => {
    const huge = '[' + Array.from({ length: 110_000 }, () => '"' + 'x'.repeat(98) + '"').join(',') + ']'; // ~11mb
    const res = await request(app.getHttpServer()).post('/api/v1/audits/aud_1/import/security-audit')
      .set('content-type', 'application/json').send(huge);
    expect(res.status).toBe(413);
  });

  it('reports malformed JSON as a client error, not a 500', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/audits/aud_1/gate/evaluate')
      .set('content-type', 'application/json').send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});
