/**
 * Minimal ECIES (P-256 ECDH + HKDF-SHA256 + AES-256-GCM) using only Web Crypto,
 * so it runs unchanged in the browser and in the Node ingest route.
 *
 * The server only ever holds the user's PUBLIC key, so it can seal data for the
 * user but cannot read anything it has sealed.
 *
 * Format: `e1.<ephemeral public key>.<iv>.<ciphertext+tag>` (base64url).
 */
import { fromB64, randomBytes, toB64, type Bytes } from './base64';

const enc = new TextEncoder();
const dec = new TextDecoder();
const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const;
const INFO = enc.encode('kosh:ecies:v1');

async function aesFromShared(shared: ArrayBuffer, salt: Bytes): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function generateIngestKeyPair() {
  const pair = await crypto.subtle.generateKey(CURVE, true, ['deriveBits']);
  return {
    publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) as Bytes,
    privatePkcs8: new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as Bytes,
  };
}

export async function importIngestPrivate(pkcs8: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', pkcs8, CURVE, false, ['deriveBits']);
}

export async function seal(publicRaw: Bytes, value: unknown, aad: string): Promise<string> {
  const ephemeral = await crypto.subtle.generateKey(CURVE, true, ['deriveBits']);
  const recipient = await crypto.subtle.importKey('raw', publicRaw, CURVE, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: recipient }, ephemeral.privateKey, 256);
  const ephRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey)) as Bytes;
  const key = await aesFromShared(shared, ephRaw);
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
      key,
      enc.encode(JSON.stringify(value)),
    ),
  );
  return `e1.${toB64(ephRaw)}.${toB64(iv)}.${toB64(ct)}`;
}

export async function open<T>(privateKey: CryptoKey, sealed: string, aad: string): Promise<T> {
  const [version, eph, iv, ct] = sealed.split('.');
  if (version !== 'e1' || !eph || !iv || !ct) throw new Error('Unsupported sealed format');
  const ephRaw = fromB64(eph);
  const sender = await crypto.subtle.importKey('raw', ephRaw, CURVE, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, privateKey, 256);
  const key = await aesFromShared(shared, ephRaw);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(iv), additionalData: enc.encode(aad) },
    key,
    fromB64(ct),
  );
  return JSON.parse(dec.decode(plain)) as T;
}
