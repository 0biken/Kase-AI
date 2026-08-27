import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ERROR_CODES,
  ErrorCode,
  ProblemDetails,
  ProblemException,
  typeUriFor,
} from './problem-details';

/**
 * Renders every error as RFC 9457 problem details (14-api §1).
 *
 * Catches everything, not just HttpException: an unhandled error leaking a
 * stack trace or a Prisma message to the client would disclose schema internals
 * — and this is a security product, so that lands badly.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const instance = request?.originalUrl ?? request?.url;

    const problem = this.toProblem(exception, instance);

    if (problem.status >= 500) {
      // Log the real cause server-side; the client gets the generic envelope.
      this.logger.error(
        `${request?.method} ${instance} -> ${problem.status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response
      .status(problem.status)
      .setHeader('Content-Type', 'application/problem+json')
      .json(problem);
  }

  private toProblem(exception: unknown, instance?: string): ProblemDetails {
    if (exception instanceof ProblemException) {
      return exception.toProblemDetails(instance);
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception, instance);
    }

    return {
      type: typeUriFor('INTERNAL'),
      title: ERROR_CODES.INTERNAL.title,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      ...(instance ? { instance } : {}),
      code: 'INTERNAL',
    };
  }

  /**
   * Maps a plain Nest HttpException onto a code. Nest's own guards and pipes
   * throw these, so they still have to produce a well-formed envelope.
   */
  private fromHttpException(exception: HttpException, instance?: string): ProblemDetails {
    const status = exception.getStatus();
    const body = exception.getResponse();
    const code = this.inferCode(status);
    const { title } = ERROR_CODES[code];

    let detail: string | undefined;
    let errors: Record<string, string[]> | undefined;

    if (typeof body === 'string') {
      detail = body;
    } else if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      if (typeof b.detail === 'string') detail = b.detail;
      else if (typeof b.message === 'string') detail = b.message;
      else if (Array.isArray(b.message)) {
        // ValidationPipe hands back a string[]; surface it as field errors
        // rather than flattening it into prose the CLI cannot parse.
        errors = groupValidationMessages(b.message as string[]);
        detail = 'One or more fields failed validation.';
      }
      if (typeof b.errors === 'object' && b.errors) {
        errors = b.errors as Record<string, string[]>;
      }
    }

    return {
      type: typeUriFor(code),
      title,
      status,
      ...(detail ? { detail } : {}),
      ...(instance ? { instance } : {}),
      code,
      ...(errors ? { errors } : {}),
    };
  }

  private inferCode(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHENTICATED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'VALIDATION_FAILED';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_FAILED';
      default:
        return status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED';
    }
  }
}

/**
 * class-validator emits flat strings like "name should not be empty".
 * Group them by the leading property so clients get a field map.
 */
function groupValidationMessages(messages: string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const message of messages) {
    const field = message.split(' ')[0] ?? '_';
    (grouped[field] ??= []).push(message);
  }
  return grouped;
}
