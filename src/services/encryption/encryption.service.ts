import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getConfig } from '@/lib/config';

export interface EncryptedPayload {
  encryptedValue: string;
  iv: string;
  authTag: string;
}

export interface IEncryptionService {
  encrypt(plaintext: string): EncryptedPayload;
  decrypt(payload: EncryptedPayload): string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

export class EncryptionService implements IEncryptionService {
  private readonly key: Buffer;

  constructor(keyHex?: string) {
    const hex = keyHex ?? getConfig().ENV_ENCRYPTION_KEY;
    this.key = Buffer.from(hex, 'hex');
    if (this.key.length !== 32) {
      throw new Error('ENV_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
    }
  }

  encrypt(plaintext: string): EncryptedPayload {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return {
      encryptedValue: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      authTag: cipher.getAuthTag().toString('hex'),
    };
  }

  decrypt(payload: EncryptedPayload): string {
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(payload.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.encryptedValue, 'hex')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}

export const encryptionService = new EncryptionService();
