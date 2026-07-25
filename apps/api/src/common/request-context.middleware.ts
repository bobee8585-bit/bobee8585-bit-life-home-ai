import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type RequestWithContext = Request & {
  requestId: string;
};

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: RequestWithContext, response: Response, next: NextFunction): void {
    const incomingRequestId = request.header('x-request-id');
    request.requestId = incomingRequestId || randomUUID();
    response.setHeader('x-request-id', request.requestId);
    next();
  }
}
