import { describe, expect, it } from 'vitest';
import { fromB64, toB64 } from '../src/lib/crypto/base64';
import { generateIngestKeyPair, importIngestPrivate, open, seal } from '../src/lib/crypto/ecies';
import { decryptJson, encryptJson, importAesKey, ingestAad, recordAad } from '../src/lib/crypto/envelope';
import { decodeBase32, encodeBase32, formatRecoveryKey, parseRecoveryKey } from '../src/lib/crypto/recovery';
import {
  WrongSecretError,
  changePassphrase,
  createVault,
  resetPassphraseWithRecoveryKey,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
} from '../src/lib/crypto/vault';

// Tiny Argon2 cost so tests are fast; production uses DEFAULT_KDF.
const FAST = { t: 1, m: 64, p: 1 } as const;
const USER = '11111111-1111-1111-1111-111111111111';
const PASS = 'correct horse battery staple';

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(1000));
    expect(fromB64(toB64(bytes))).toEqual(bytes);
  });
  it('uses only url-safe characters', () => {
    expect(toB64(new Uint8Array([251, 255, 254]))).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('record envelopes', () => {
  it('round-trips JSON', async () => {
    const key = await importAesKey(crypto.getRandomValues(new Uint8Array(32)));
    const aad = recordAad(USER, 'transaction', 'abc');
    const env = await encryptJson(key, { amount: -12500, payee: 'Swiggy' }, aad);
    expect(env.startsWith('v1.')).toBe(true);
    expect(env).not.toContain('Swiggy');
    expect(await decryptJson(key, env, aad)).toEqual({ amount: -12500, payee: 'Swiggy' });
  });

  it('uses a fresh IV every time', async () => {
    const key = await importAesKey(crypto.getRandomValues(new Uint8Array(32)));
    const a = await encryptJson(key, 1, 'x');
    const b = await encryptJson(key, 1, 'x');
    expect(a).not.toBe(b);
  });

  it('rejects the wrong key', async () => {
    const k1 = await importAesKey(crypto.getRandomValues(new Uint8Array(32)));
    const k2 = await importAesKey(crypto.getRandomValues(new Uint8Array(32)));
    const env = await encryptJson(k1, { a: 1 }, 'x');
    await expect(decryptJson(k2, env, 'x')).rejects.toThrow();
  });

  it('rejects a ciphertext moved to another row or user (AAD binding)', async () => {
    const key = await importAesKey(crypto.getRandomValues(new Uint8Array(32)));
    const env = await encryptJson(key, { a: 1 }, recordAad(USER, 'transaction', 'row-1'));
    await expect(decryptJson(key, env, recordAad(USER, 'transaction', 'row-2'))).rejects.toThrow();
    await expect(decryptJson(key, env, recordAad(USER, 'account', 'row-1'))).rejects.toThrow();
    await expect(decryptJson(key, env, recordAad('someone-else', 'transaction', 'row-1'))).rejects.toThrow();
  });

  it('detects tampering', async () => {
    const key = await importAesKey(crypto.getRandomValues(new Uint8Array(32)));
    const env = await encryptJson(key, { a: 1 }, 'x');
    const [v, iv, ct] = env.split('.');
    const flipped = ct.slice(0, -2) + (ct.endsWith('AA') ? 'BB' : 'AA');
    await expect(decryptJson(key, `${v}.${iv}.${flipped}`, 'x')).rejects.toThrow();
  });
});

describe('ECIES sealing for the ingest webhook', () => {
  it('lets the holder of the private key open what the public key sealed', async () => {
    const { publicRaw, privatePkcs8 } = await generateIngestKeyPair();
    const aad = ingestAad(USER, 'evt-1');
    const sealed = await seal(publicRaw, { amount: 25000, merchant: 'Swiggy' }, aad);
    expect(sealed.startsWith('e1.')).toBe(true);
    expect(sealed).not.toContain('Swiggy');
    const priv = await importIngestPrivate(privatePkcs8);
    expect(await open(priv, sealed, aad)).toEqual({ amount: 25000, merchant: 'Swiggy' });
  });

  it('cannot be opened by another key or under another event id', async () => {
    const a = await generateIngestKeyPair();
    const b = await generateIngestKeyPair();
    const sealed = await seal(a.publicRaw, { x: 1 }, ingestAad(USER, 'evt-1'));
    await expect(open(await importIngestPrivate(b.privatePkcs8), sealed, ingestAad(USER, 'evt-1'))).rejects.toThrow();
    await expect(open(await importIngestPrivate(a.privatePkcs8), sealed, ingestAad(USER, 'evt-2'))).rejects.toThrow();
  });

  it('produces a different ciphertext for the same message', async () => {
    const { publicRaw } = await generateIngestKeyPair();
    expect(await seal(publicRaw, 1, 'x')).not.toBe(await seal(publicRaw, 1, 'x'));
  });
});

describe('recovery key encoding', () => {
  it('round-trips and tolerates typing mistakes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const text = formatRecoveryKey(bytes);
    expect(text).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
    expect(parseRecoveryKey(text)).toEqual(bytes);
    expect(parseRecoveryKey(text.toLowerCase().replace(/-/g, ' '))).toEqual(bytes);
  });
  it('base32 round-trips', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes);
  });
  it('rejects the wrong length', () => {
    expect(() => parseRecoveryKey('ABCD-EFGH')).toThrow();
  });
});

describe('vault', () => {
  it('creates a vault that unlocks with the passphrase and the recovery key', async () => {
    const { bundle, recoveryKey, unlocked } = await createVault(USER, PASS, FAST);

    const viaPass = await unlockWithPassphrase(bundle, USER, PASS);
    const viaRecovery = await unlockWithRecoveryKey(bundle, USER, recoveryKey);

    // All three handles decrypt the same data.
    const env = await encryptJson(unlocked.dk, { secret: 42 }, 'aad');
    expect(await decryptJson(viaPass.dk, env, 'aad')).toEqual({ secret: 42 });
    expect(await decryptJson(viaRecovery.dk, env, 'aad')).toEqual({ secret: 42 });

    // The recovered ingest private key opens what the public key sealed.
    const sealed = await seal(fromB64(bundle.ingest_public_key), { ok: true }, 'sealed-aad');
    expect(await open(viaPass.ingestPrivate, sealed, 'sealed-aad')).toEqual({ ok: true });
  });

  it('keeps the data key non-extractable once unlocked', async () => {
    const { bundle } = await createVault(USER, PASS, FAST);
    const unlocked = await unlockWithPassphrase(bundle, USER, PASS);
    expect(unlocked.dk.extractable).toBe(false);
    expect(unlocked.ingestPrivate.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', unlocked.dk)).rejects.toThrow();
  });

  it('stores nothing in the bundle that reveals secrets', async () => {
    const { bundle, recoveryKey } = await createVault(USER, PASS, FAST);
    const text = JSON.stringify(bundle);
    expect(text).not.toContain(PASS);
    expect(text).not.toContain(recoveryKey.replace(/-/g, ''));
  });

  it('rejects a wrong passphrase and a wrong recovery key', async () => {
    const { bundle } = await createVault(USER, PASS, FAST);
    await expect(unlockWithPassphrase(bundle, USER, 'wrong passphrase!!')).rejects.toBeInstanceOf(WrongSecretError);
    const other = await createVault(USER, PASS, FAST);
    await expect(unlockWithRecoveryKey(bundle, USER, other.recoveryKey)).rejects.toBeInstanceOf(WrongSecretError);
    await expect(unlockWithRecoveryKey(bundle, USER, 'nonsense')).rejects.toBeInstanceOf(WrongSecretError);
  });

  it('refuses a key bundle that was swapped onto another user', async () => {
    const { bundle } = await createVault(USER, PASS, FAST);
    await expect(unlockWithPassphrase(bundle, 'another-user-id', PASS)).rejects.toBeInstanceOf(WrongSecretError);
  });

  it('changes the passphrase without re-encrypting data', async () => {
    const { bundle, unlocked } = await createVault(USER, PASS, FAST);
    const env = await encryptJson(unlocked.dk, { n: 1 }, 'aad');

    const next = await changePassphrase(bundle, USER, PASS, 'a brand new passphrase', FAST);
    await expect(unlockWithPassphrase(next, USER, PASS)).rejects.toBeInstanceOf(WrongSecretError);
    const reopened = await unlockWithPassphrase(next, USER, 'a brand new passphrase');
    expect(await decryptJson(reopened.dk, env, 'aad')).toEqual({ n: 1 });
    expect(next.kdf.salt).not.toBe(bundle.kdf.salt);
  });

  it('resets a forgotten passphrase using the recovery key', async () => {
    const { bundle, recoveryKey, unlocked } = await createVault(USER, PASS, FAST);
    const env = await encryptJson(unlocked.dk, { n: 2 }, 'aad');

    const next = await resetPassphraseWithRecoveryKey(bundle, USER, recoveryKey, 'forgot and reset 123', FAST);
    const reopened = await unlockWithPassphrase(next, USER, 'forgot and reset 123');
    expect(await decryptJson(reopened.dk, env, 'aad')).toEqual({ n: 2 });
  });

  it('normalises equivalent unicode passphrases', async () => {
    const { bundle } = await createVault(USER, 'café society 2026', FAST);
    await expect(unlockWithPassphrase(bundle, USER, 'café society 2026')).resolves.toBeDefined();
  });
});
