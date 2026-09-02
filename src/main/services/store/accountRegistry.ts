/**
 * AccountRegistry — main-process-only credential cache.
 *
 * Passwords parsed from accounts.txt are stored HERE (in the main process)
 * and never sent back to the renderer. The renderer only receives
 * email/domain/proxy metadata; when it asks to register an account it
 * references a record by `id` and the password is attached server-side.
 *
 * This enforces the security requirement from TechTask §8.2:
 * "Passwords must not reach the renderer process".
 */
import type { Account } from '../../../renderer/lib/types';

export interface CredentialRecord {
  id: string;
  email: string;
  /** Plaintext in main process memory only; protected further by secureMemory on registration. */
  password: string;
  domain: string;
  proxy: string | null;
}

const registry = new Map<string, CredentialRecord>();

/** Store parsed credentials under a generated/known id. Returns the id used. */
export function putCredentials(record: CredentialRecord): string {
  registry.set(record.id, record);
  return record.id;
}

/** Take credentials for an account id. Returns undefined if unknown/expired. */
export function getCredentials(id: string): CredentialRecord | undefined {
  return registry.get(id);
}

/** Drop one credential entry (after successful registration or re-import). */
export function deleteCredentials(id: string): void {
  registry.delete(id);
}

/** Drop all entries (used on config re-import to avoid stale plaintext). */
export function clearCredentials(): void {
  registry.clear();
}

/** Build a safe public shape of a parsed account line WITHOUT the password. */
export function toPublicAccount(
  rec: CredentialRecord,
  overrides: Partial<Account> = {}
): Account {
  return {
    id: rec.id,
    email: rec.email,
    domain: rec.domain,
    status: 'offline',
    proxy: rec.proxy,
    ...overrides,
  };
}
