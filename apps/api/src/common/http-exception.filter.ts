import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import type { RequestWithContext } from './request-context.middleware';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'message' in exceptionResponse
        ? String(exceptionResponse.message)
        : status === HttpStatus.INTERNAL_SERVER_ERROR
          ? '서버에서 요청을 처리하지 못했습니다.'
          : String(exceptionResponse ?? '요청을 처리하지 못했습니다.');

    response.status(status).json({
      success: false,
      error: {
        code: this.resolveCode(status),
        message,
      },
      meta: {
        requestId: request.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  private resolveCode(status: number): string {
    const codes: Partial<Record<number, string>> = {
      [HttpStatus.BAD_REQUEST]: 'INVALID_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'AUTH_REQUIRED',
      [HttpStatus.FORBIDDEN]: 'PERMISSION_DENIED',
      [HttpStatus.NOT_FOUND]: 'RESOURCE_NOT_FOUND',
      [HttpStatus.CONFLICT]: 'RESOURCE_CONFLICT',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMIT_EXCEEDED',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_MAINTENANCE',
    };

    return codes[status] ?? 'INTERNAL_SERVER_ERROR';
  }
}
