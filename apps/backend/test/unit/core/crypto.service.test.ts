import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/core/crypto/crypto.service';

function makeCryptoService(): CryptoService {
  return new CryptoService(randomBytes(32));
}

describe('CryptoService', () => {
  it('roundtrips a plaintext', () => {
    const svc = makeCryptoService();
    const plain = 'sk-secret-access-token-12345';
    expect(svc.decrypt(svc.encrypt(plain))).toBe(plain);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const svc = makeCryptoService();
    const a = svc.encrypt('hello');
    const b = svc.encrypt('hello');
    expect(a).not.toBe(b);
    expect(svc.decrypt(a)).toBe('hello');
    expect(svc.decrypt(b)).toBe('hello');
  });

  it('throws on tampered ciphertext', () => {
    const svc = makeCryptoService();
    const ct = svc.encrypt('hello');
    const tampered = `${ct.slice(0, -2)}AA`;
    expect(() => svc.decrypt(tampered)).toThrow();
  });
});
