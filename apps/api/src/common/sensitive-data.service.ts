import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';

function secretKey(): Buffer {
  const configured = process.env.PII_ENCRYPTION_KEY;
  if (!configured && process.env.NODE_ENV === 'production') {
    throw new Error('PII_ENCRYPTION_KEY is required in production.');
  }
  return createHash('sha256')
    .update(configured ?? 'life-home-local-pii-key-change-before-production')
    .digest();
}

@Injectable()
export class SensitiveDataService {
  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted]
      .map((part) => part.toString('base64url'))
      .join('.');
  }

  decrypt(value: string): string {
    const [ivValue, tagValue, encryptedValue] = value.split('.');
    if (!ivValue || !tagValue || !encryptedValue) {
      throw new Error('Encrypted value is malformed.');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      secretKey(),
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  hash(value: string): string {
    return createHmac('sha256', secretKey())
      .update(value)
      .digest('hex');
  }
}
