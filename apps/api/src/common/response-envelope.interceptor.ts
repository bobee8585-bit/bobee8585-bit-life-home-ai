import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiSuccess } from '@lifehome/contracts';
import { map, type Observable } from 'rxjs';
import { RAW_RESPONSE_METADATA } from './raw-response.decorator';
import type { RequestWithContext } from './request-context.middleware';

@Injectable()
export class ResponseEnvelopeInterceptor<T>
  implements NestInterceptor<T, ApiSuccess<T> | T>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccess<T> | T> {
    const raw = this.reflector.getAllAndOverride<boolean>(
      RAW_RESPONSE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (raw) {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<RequestWithContext>();

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        meta: {
          requestId: request.requestId,
          timestamp: new Date().toISOString(),
        },
      })),
    );
  }
}
