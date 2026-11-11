import { encrypt, decrypt } from './crypto.js';

// Connected accounts store their per-platform credentials as an encrypted JSON
// blob. `hydrate` returns a copy with plaintext credentials for the publisher;
// `publicAccount` returns a safe projection (no secrets) for the API.
export function encodeCreds(creds) {
  return encrypt(JSON.stringify(creds || {}));
}

export function decodeCreds(enc) {
  const raw = decrypt(enc);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function hydrate(account) {
  return { ...account, credentials: decodeCreds(account.credentialsEnc) };
}

export function publicAccount(account) {
  const creds = decodeCreds(account.credentialsEnc);
  return {
    id: account.id,
    platform: account.platform,
    label: account.label,
    handle: account.handle || '',
    status: account.status || 'connected',
    createdAt: account.createdAt,
    lastUsedAt: account.lastUsedAt || null,
    // Report which fields are set, never their values.
    fields: Object.fromEntries(Object.keys(creds).map((k) => [k, Boolean(creds[k])])),
  };
}
