/** Wallet apps often export private keys without the 0x prefix. Accept either form. */
export function normaliseKey(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined;
  const k = raw.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(k)) throw new Error("Private key setting is not a 64-character hex key");
  return `0x${k}`;
}
