import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ProblemDetailsFilter } from './problem-details.filter';
import { ERROR_CODES, ProblemException, typeUriFor } from './problem-details';

function mockHost(url = '/api/v1/projects') {
  const json = jest.fn();
  const setHeader = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnValue({ setHeader, json });
  // setHeader must chain into json for the filter's fluent call.
  setHeader.mockReturnValue({ json });
  const response = { status, setHeader, json };
  const request = { url, originalUrl: url, method: 'POST' };
  return {
    host: {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as unknown as ArgumentsHost,
    status,
    json,
    setHeader,
  };
}

describe('ProblemDetailsFilter — RFC 9457 envelope (14-api §1)', () => {
  const filter = new ProblemDetailsFilter();

  it('renders a ProblemException with all documented members', () => {
    const { host, status, json } = mockHost('/api/v1/projects/prj_01H/audits');
    filter.catch(
      new ProblemException('SCOPE_VIOLATION', "Host 'api.other.com' is not in allowedHosts."),
      host,
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'https://kase.dev/errors/scope-violation',
        title: ERROR_CODES.SCOPE_VIOLATION.title,
        status: 422,
        detail: expect.stringContaining('api.other.com'),
        instance: '/api/v1/projects/prj_01H/audits',
        code: 'SCOPE_VIOLATION',
      }),
    );
  });

  it('sets the problem+json content type', () => {
    const { host, setHeader } = mockHost();
    filter.catch(new ProblemException('NOT_FOUND'), host);
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/problem+json');
  });

  it('keeps SCOPE_VIOLATION at 422, distinct from FORBIDDEN', () => {
    // 15-cli §3 maps scope violation to exit 3 and auth failure to exit 4.
    // Collapsing these into one status would break that branch.
    expect(ERROR_CODES.SCOPE_VIOLATION.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(ERROR_CODES.FORBIDDEN.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('never leaks internals for an unknown error', () => {
    // The filter logs the real cause server-side; silence it here but assert
    // it still happens, since that log is the only record of a 500's cause.
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, status, json } = mockHost();
    filter.catch(new Error('connect ECONNREFUSED 10.0.0.5:5432 relation "User"'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.code).toBe('INTERNAL');
    // The database host and schema details must not reach the client.
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
    expect(body.detail).toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('maps a plain Nest exception onto a code', () => {
    const { host, json } = mockHost();
    filter.catch(new ForbiddenException('nope'), host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403, code: 'FORBIDDEN' }),
    );
  });

  it('groups ValidationPipe messages into a field map', () => {
    const { host, json } = mockHost();
    filter.catch(
      new BadRequestException({
        message: ['name should not be empty', 'name must be a string', 'url must be a URL'],
      }),
      host,
    );

    const body = json.mock.calls[0][0];
    expect(body.errors).toEqual({
      name: ['name should not be empty', 'name must be a string'],
      url: ['url must be a URL'],
    });
  });

  it('derives every type URI from its code', () => {
    for (const code of Object.keys(ERROR_CODES) as (keyof typeof ERROR_CODES)[]) {
      expect(typeUriFor(code)).toBe(
        `https://kase.dev/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      );
      expect(typeUriFor(code)).not.toContain('_');
    }
  });
});
