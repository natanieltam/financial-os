import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../server/utils/password'

describe('password hashing', () => {
  it('uses Argon2id and never stores plaintext', async () => {
    const stored = await hashPassword('CorrectHorse9!')
    expect(stored).toMatch(/^\$argon2id\$/)
    expect(stored).not.toContain('CorrectHorse9!')
  })

  it('verifies the correct password and rejects the wrong one', async () => {
    const stored = await hashPassword('CorrectHorse9!')
    expect(await verifyPassword(stored, 'CorrectHorse9!')).toBe(true)
    expect(await verifyPassword(stored, 'WrongPassword9!')).toBe(false)
    expect(await verifyPassword('not-a-hash', 'CorrectHorse9!')).toBe(false)
  })

  it('produces a unique salt per hash', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
    expect(await verifyPassword(a, 'same-password')).toBe(true)
    expect(await verifyPassword(b, 'same-password')).toBe(true)
  })
})
