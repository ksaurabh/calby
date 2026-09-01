// Encryption for secrets held in the JSON data files (currently the per-org
// Anthropic API key). Plaintext keys on disk would be readable by anything that
// can see the repo directory or a backup copy, so they are sealed with
// AES-256-GCM under a server-held secret.
//
// The sealing key comes from ANTHROPIC_KEY_SECRET, falling back to
// SESSION_SECRET. Changing whichever one is in use makes existing values
// undecryptable — they are then treated as unset and must be re-entered.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const VERSION = 'v1';
const SALT = 'calby-secret-v1';

function sealingKey() {
  const secret = process.env.ANTHROPIC_KEY_SECRET || process.env.SESSION_SECRET;
  if (!secret) return null;
  return scryptSync(secret, SALT, 32);
}

export function canSealSecrets() {
  return !!sealingKey();
}

export function encryptSecret(plaintext) {
  const key = sealingKey();
  if (!key) throw new Error('Set SESSION_SECRET (or ANTHROPIC_KEY_SECRET) before storing API keys.');

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    sealed.toString('base64'),
  ].join(':');
}

// Returns null rather than throwing: an undecryptable value (rotated secret,
// corrupted file) should degrade to "no key", not take the server down.
export function decryptSecret(sealed) {
  const key = sealingKey();
  if (!key || typeof sealed !== 'string') return null;

  const [version, iv, tag, payload] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || !payload) return null;

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** "sk-ant-…f3Ab" — enough to recognise a key, not enough to use it. */
export function maskSecret(plaintext) {
  if (!plaintext || plaintext.length < 12) return '••••';
  return `${plaintext.slice(0, 7)}…${plaintext.slice(-4)}`;
}
