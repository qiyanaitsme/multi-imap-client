import { safeStorage } from 'electron'

/**
 * In-memory password protection.
 *
 * Passwords arrive from accounts.txt in plaintext. Keeping them as plain strings
 * in long-lived Account objects means they'd show up verbatim in a heap/memory
 * dump for the entire session. Instead we encrypt them with the OS keychain
 * (safeStorage: DPAPI on Windows, Keychain on macOS, libsecret on Linux) as soon
 * as they're registered, and only decrypt them for the brief moment of connecting.
 *
 * If OS encryption is unavailable (e.g. some Linux setups), we fall back to a
 * lightweight XOR obfuscation with a random per-process key. This is NOT strong
 * cryptography, but it avoids storing raw plaintext and prevents casual scraping.
 */

const FALLBACK_PREFIX = 'xor:'
const SAFE_PREFIX = 'safe:'

// Random per-process key used only for the fallback path.
const fallbackKey = randomBytes(32)

function randomBytes(n: number): Buffer {
  // Avoid importing crypto at module top for tree-shaking friendliness.
  const { randomBytes: rb } = require('node:crypto')
  return rb(n) as Buffer
}

function xor(data: Buffer, key: Buffer): Buffer {
  const out = Buffer.allocUnsafe(data.length)
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ key[i % key.length]
  }
  return out
}

/**
 * Encrypt a plaintext secret for in-memory storage.
 * Returns an opaque, prefixed token safe to keep in an object field.
 */
export function protectSecret(plain: string): string {
  if (!plain) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return SAFE_PREFIX + safeStorage.encryptString(plain).toString('base64')
    }
  } catch {
    // fall through to obfuscation
  }
  return FALLBACK_PREFIX + xor(Buffer.from(plain, 'utf-8'), fallbackKey).toString('base64')
}

/**
 * Decrypt a token produced by protectSecret back to plaintext.
 * Accepts un-prefixed input too (treated as already-plain) for backward safety.
 */
export function revealSecret(token: string): string {
  if (!token) return ''
  try {
    if (token.startsWith(SAFE_PREFIX)) {
      const buf = Buffer.from(token.slice(SAFE_PREFIX.length), 'base64')
      return safeStorage.decryptString(buf)
    }
    if (token.startsWith(FALLBACK_PREFIX)) {
      const buf = Buffer.from(token.slice(FALLBACK_PREFIX.length), 'base64')
      return xor(buf, fallbackKey).toString('utf-8')
    }
  } catch {
    return ''
  }
  // No known prefix — assume it's already plaintext (shouldn't normally happen).
  return token
}
