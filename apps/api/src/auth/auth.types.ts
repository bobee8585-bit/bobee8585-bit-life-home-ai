import type { Request } from 'express';
import type { Platform } from '../generated/prisma/client';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  roles: string[];
  status: string;
  iat?: number;
  exp?: number;
}

export type AuthenticatedRequest = Request & {
  auth: AccessTokenPayload;
};

export interface ClientContext {
  platform?: Platform;
  ipAddress?: string;
  userAgent?: string;
}
