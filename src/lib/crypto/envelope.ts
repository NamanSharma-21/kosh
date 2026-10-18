import { fromB64, randomBytes, toB64 } from './base64';

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Bind every ciphertext to its owner, table and row so the server cannot
 * move a valid ciphertext to a different row or user.
 */
export const recordAad = (userId: string, kind: string, id: string) => `kosh|v1|${userId}|${kind}|${id}`;
export const wrapAad = (userId: string, what: 'dk' | 'dk_recovery' | 'ingest') => `kosh|v1|wrap|${userId}|${what}`;
export const ingestAad = (userId: string, eventId: string) => `kosh|v1|ingest|${userId}|${eventId}`;

/** AES-256-GCM, random 96-bit IV. Format: `v1.<iv>.<ciphertext+tag>` (base64url). */
export async function encryptJson(key: CryptoKey, value: unknown, aad: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
      key,
      enc.encode(JSON.stringify(value)),
    ),
  );
  return `v1.${toB64(iv)}.${toB64(ct)}`;
}

export async function decryptJson<T>(key: CryptoKey, envelope: string, aad: string): Promise<T> {
  const [version, iv, ct] = envelope.split('.');
  if (version !== 'v1' || !iv || !ct) throw new Error('Unsupported ciphertext format');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(iv), additionalData: enc.encode(aad) },
    key,
    fromB64(ct),
  );
  return JSON.parse(dec.decode(plain)) as T;
}

export async function importAesKey(raw: Uint8Array<ArrayBuffer>, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}
