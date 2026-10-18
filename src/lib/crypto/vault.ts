/**
 * Key hierarchy
 * -------------
 *   passphrase ──Argon2id──► KEK ──wraps──► DK (random 256-bit data key)
 *   recovery key (random 256-bit) ─────────wraps──► DK (second copy)
 *   DK encrypts every record, and wraps the ingest PRIVATE key.
 *   The ingest PUBLIC key is stored in the clear so the webhook can seal
 *   incoming transactions that only this vault can open.
 *
 * The server stores only the wrapped forms. It never sees the passphrase, the
 * recovery key, the data key or the ingest private key.
 */
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { fromB64, randomBytes, toB64, type Bytes } from './base64';
import { decryptJson, encryptJson, importAesKey, wrapAad } from './envelope';
import { generateIngestKeyPair, importIngestPrivate } from './ecies';
import { formatRecoveryKey, parseRecoveryKey } from './recovery';

export interface KdfParams {
  alg: 'argon2id';
  /** iterations */
  t: number;
  /** memory in KiB */
  m: number;
  p: number;
  /** base64url salt */
  salt: string;
}

/** Row shape of `public.user_keys` (everything here is safe for the server to hold). */
export interface KeyBundle {
  kdf: KdfParams;
  wrapped_dk: string;
  wrapped_dk_recovery: string;
  ingest_public_key: string;
  wrapped_ingest_private: string;
  version: number;
}

export interface Unlocked {
  dk: CryptoKey;
  ingestPrivate: CryptoKey;
  /** base64url raw P-256 public key */
  ingestPublic: string;
}

export class WrongSecretError extends Error {
  constructor(what: 'passphrase' | 'recovery key') {
    super(`That ${what} is incorrect.`);
    this.name = 'WrongSecretError';
  }
}

/** OWASP-recommended Argon2id minimum is m=19 MiB, t=2, p=1; we use t=3. */
export const DEFAULT_KDF = { alg: 'argon2id', t: 3, m: 19456, p: 1 } as const;

export function normalisePassphrase(p: string): string {
  return p.normalize('NFKC');
}

export async function deriveKek(passphrase: string, kdf: KdfParams): Promise<CryptoKey> {
  const raw = await argon2idAsync(new TextEncoder().encode(normalisePassphrase(passphrase)), fromB64(kdf.salt), {
    t: kdf.t,
    m: kdf.m,
    p: kdf.p,
    dkLen: 32,
    asyncTick: 20,
  });
  return importAesKey(new Uint8Array(raw) as Bytes);
}

async function unwrapRawDk(
  bundle: KeyBundle,
  userId: string,
  kek: CryptoKey,
  which: 'dk' | 'dk_recovery',
): Promise<Bytes> {
  try {
    const b64 = await decryptJson<string>(
      kek,
      which === 'dk' ? bundle.wrapped_dk : bundle.wrapped_dk_recovery,
      wrapAad(userId, which),
    );
    return fromB64(b64);
  } catch {
    throw new WrongSecretError(which === 'dk' ? 'passphrase' : 'recovery key');
  }
}

async function openWithRawDk(bundle: KeyBundle, userId: string, rawDk: Bytes): Promise<Unlocked> {
  const dk = await importAesKey(rawDk); // non-extractable from here on
  const pkcs8 = fromB64(await decryptJson<string>(dk, bundle.wrapped_ingest_private, wrapAad(userId, 'ingest')));
  return { dk, ingestPrivate: await importIngestPrivate(pkcs8), ingestPublic: bundle.ingest_public_key };
}

export async function createVault(
  userId: string,
  passphrase: string,
  kdfCost: Pick<KdfParams, 't' | 'm' | 'p'> = DEFAULT_KDF,
): Promise<{ bundle: KeyBundle; recoveryKey: string; unlocked: Unlocked }> {
  const rawDk = randomBytes(32);
  const kdf: KdfParams = { alg: 'argon2id', ...kdfCost, salt: toB64(randomBytes(16)) };
  const kek = await deriveKek(passphrase, kdf);

  const recoveryBytes = randomBytes(32);
  const recoveryKek = await importAesKey(recoveryBytes);

  const dk = await importAesKey(rawDk);
  const { publicRaw, privatePkcs8 } = await generateIngestKeyPair();

  const bundle: KeyBundle = {
    kdf,
    wrapped_dk: await encryptJson(kek, toB64(rawDk), wrapAad(userId, 'dk')),
    wrapped_dk_recovery: await encryptJson(recoveryKek, toB64(rawDk), wrapAad(userId, 'dk_recovery')),
    ingest_public_key: toB64(publicRaw),
    wrapped_ingest_private: await encryptJson(dk, toB64(privatePkcs8), wrapAad(userId, 'ingest')),
    version: 1,
  };

  return {
    bundle,
    recoveryKey: formatRecoveryKey(recoveryBytes),
    unlocked: { dk, ingestPrivate: await importIngestPrivate(privatePkcs8), ingestPublic: bundle.ingest_public_key },
  };
}

export async function unlockWithPassphrase(bundle: KeyBundle, userId: string, passphrase: string): Promise<Unlocked> {
  const kek = await deriveKek(passphrase, bundle.kdf);
  return openWithRawDk(bundle, userId, await unwrapRawDk(bundle, userId, kek, 'dk'));
}

export async function unlockWithRecoveryKey(bundle: KeyBundle, userId: string, recoveryKey: string): Promise<Unlocked> {
  let kek: CryptoKey;
  try {
    kek = await importAesKey(parseRecoveryKey(recoveryKey));
  } catch {
    throw new WrongSecretError('recovery key');
  }
  return openWithRawDk(bundle, userId, await unwrapRawDk(bundle, userId, kek, 'dk_recovery'));
}

/** Re-wrap the data key under a new passphrase. Records themselves are untouched. */
async function rewrap(
  bundle: KeyBundle,
  userId: string,
  rawDk: Bytes,
  newPassphrase: string,
  kdfCost: Pick<KdfParams, 't' | 'm' | 'p'>,
): Promise<KeyBundle> {
  const kdf: KdfParams = { alg: 'argon2id', ...kdfCost, salt: toB64(randomBytes(16)) };
  const kek = await deriveKek(newPassphrase, kdf);
  return { ...bundle, kdf, wrapped_dk: await encryptJson(kek, toB64(rawDk), wrapAad(userId, 'dk')) };
}

export async function changePassphrase(
  bundle: KeyBundle,
  userId: string,
  oldPassphrase: string,
  newPassphrase: string,
  kdfCost: Pick<KdfParams, 't' | 'm' | 'p'> = DEFAULT_KDF,
): Promise<KeyBundle> {
  const rawDk = await unwrapRawDk(bundle, userId, await deriveKek(oldPassphrase, bundle.kdf), 'dk');
  return rewrap(bundle, userId, rawDk, newPassphrase, kdfCost);
}

export async function resetPassphraseWithRecoveryKey(
  bundle: KeyBundle,
  userId: string,
  recoveryKey: string,
  newPassphrase: string,
  kdfCost: Pick<KdfParams, 't' | 'm' | 'p'> = DEFAULT_KDF,
): Promise<KeyBundle> {
  let kek: CryptoKey;
  try {
    kek = await importAesKey(parseRecoveryKey(recoveryKey));
  } catch {
    throw new WrongSecretError('recovery key');
  }
  const rawDk = await unwrapRawDk(bundle, userId, kek, 'dk_recovery');
  return rewrap(bundle, userId, rawDk, newPassphrase, kdfCost);
}

export const MIN_PASSPHRASE_LENGTH = 12;
