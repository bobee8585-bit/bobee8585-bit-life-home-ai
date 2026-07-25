import { describe, expect, it } from 'vitest';
import { PasswordHasherService } from './password-hasher.service';

describe('PasswordHasherService', () => {
  const hasher = new PasswordHasherService();

  it('hashes and verifies a password', async () => {
    const hash = await hasher.hash('Safe-password-2026');
    await expect(hasher.verify('Safe-password-2026', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hasher.hash('Safe-password-2026');
    await expect(hasher.verify('incorrect-password', hash)).resolves.toBe(
      false,
    );
  });

  it('rejects unsupported hash formats', async () => {
    await expect(hasher.verify('password', 'legacy$hash')).resolves.toBe(false);
  });
});
