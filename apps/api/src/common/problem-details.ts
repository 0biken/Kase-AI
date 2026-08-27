import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * RFC 9457 problem details, plus the non-standard `code` member that 14-api §1
 * specifies. `code` exists because the CLI branches on it: 15-cli §3 maps a
 * scope violation to exit 3 and an auth failure to exit 4, and neither status
 * code nor prose is a stable enough discriminator for that.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  /** Field-level validation failures, when the error is a 422 from a DTO. */
  errors?: Record<string, string[]>;
}

const ERROR_BASE = 'https://kase.dev/errors';

/**
 * Error codes. SCREAMING_SNAKE per the §1 example.
 *
 * SCOPE_VIOLATION is deliberately 422, not 400 or 403 — 14-api §1 shows it as
 * 422, and conflating it with an authorization failure would make the CLI
 * report exit 4 (auth) for what is actually exit 3 (scope).
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: { status: HttpStatus.UNPROCESSABLE_ENTITY, title: 'Request validation failed' },
  SCOPE_VIOLATION: { status: HttpStatus.UNPROCESSABLE_ENTITY, title: 'Scope policy violation' },
  ATTESTATION_REQUIRED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    title: 'Authorization attestation required',
  },
  ATTESTATION_STALE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    title: 'Authorization attestation has expired',
  },
  UNAUTHENTICATED: { status: HttpStatus.UNAUTHORIZED, title: 'Authentication required' },
  FORBIDDEN: { status: HttpStatus.FORBIDDEN, title: 'Insufficient permissions' },
  PROJECT_SCOPE_DENIED: { status: HttpStatus.FORBIDDEN, title: 'Credential is not scoped to this project' },
  NOT_FOUND: { status: HttpStatus.NOT_FOUND, title: 'Resource not found' },
  CONFLICT: { status: HttpStatus.CONFLICT, title: 'Resource conflict' },
  IDEMPOTENCY_KEY_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    title: 'Idempotency-Key header is required',
  },
  RATE_LIMITED: { status: HttpStatus.TOO_MANY_REQUESTS, title: 'Rate limit exceeded' },
  INTERNAL: { status: HttpStatus.INTERNAL_SERVER_ERROR, title: 'Internal server error' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** `SCOPE_VIOLATION` -> `https://kase.dev/errors/scope-violation` */
export function typeUriFor(code: ErrorCode): string {
  return `${ERROR_BASE}/${code.toLowerCase().replace(/_/g, '-')}`;
}

/**
 * A domain error carrying its problem-details code. Throw this rather than a
 * bare HttpException so the filter never has to guess a `code`.
 */
export class ProblemException extends HttpException {
  readonly code: ErrorCode;
  readonly detail?: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    code: ErrorCode,
    detail?: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    const { status, title } = ERROR_CODES[code];
    super({ code, title, detail }, status);
    this.code = code;
    this.detail = detail;
    this.fieldErrors = fieldErrors;
  }

  toProblemDetails(instance?: string): ProblemDetails {
    const { status, title } = ERROR_CODES[this.code];
    return {
      type: typeUriFor(this.code),
      title,
      status,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(instance ? { instance } : {}),
      code: this.code,
      ...(this.fieldErrors ? { errors: this.fieldErrors } : {}),
    };
  }
}
