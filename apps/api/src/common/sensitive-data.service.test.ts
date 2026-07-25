import { describe, expect, it } from 'vitest';
import { SensitiveDataService } from './sensitive-data.service';

describe('SensitiveDataService', () => {
  const service = new SensitiveDataService();

  it('encrypts and decrypts sensitive values', () => {
    const plain = 'KR:+821012345678';
    const encrypted = service.encrypt(plain);

    expect(encrypted).not.toContain(plain);
    expect(service.decrypt(encrypted)).toBe(plain);
  });

  it('creates stable keyed hashes', () => {
    expect(service.hash('same')).toBe(service.hash('same'));
    expect(service.hash('same')).not.toBe(service.hash('different'));
  });
});
