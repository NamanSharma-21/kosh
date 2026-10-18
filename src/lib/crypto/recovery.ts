import type { Bytes } from './base64';

/** Crockford base32: no I, L, O, U, so it survives being read out or typed from paper. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function decodeBase32(text: string): Bytes {
  const clean = text
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid recovery key');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** 32 random bytes → `XXXX-XXXX-…` (52 characters in 13 groups). */
export function formatRecoveryKey(bytes: Uint8Array): string {
  return encodeBase32(bytes).match(/.{1,4}/g)!.join('-');
}

export function parseRecoveryKey(text: string): Bytes {
  const bytes = decodeBase32(text);
  if (bytes.length !== 32) throw new Error('That recovery key is the wrong length.');
  return bytes;
}
