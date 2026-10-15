import { hash, verify } from '@node-rs/argon2'
import { randomBytes } from 'node:crypto'

/**
 * Argon2id — @node-rs/argon2 defaults to Argon2id (PRD §14); produced hashes
 * carry the `$argon2id$` prefix, asserted in tests/password.test.ts.
 * OWASP baseline params: 19 MiB, t=2, p=1.
 * Never store plaintext passwords (PRD §13, §14).
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password)
  } catch {
    return false
  }
}

/** Constant-time decoy for unknown-email logins (prevents user enumeration). */
let dummyHashPromise: Promise<string> | undefined
function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(24).toString('base64url'))
  return dummyHashPromise
}

export async function fakeVerify(password: string): Promise<void> {
  await verifyPassword(await dummyPasswordHash(), password)
}
