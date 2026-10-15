import { describe, expect, it } from 'vitest'
import {
  MoneyError,
  addMoney,
  centsToMoney,
  cmpMoney,
  isPositiveMoney,
  moneyToCents,
  normalizeMoney,
  subMoney,
} from '../shared/money'

describe('shared/money (BigInt cents — never floats)', () => {
  it('normalizes decimal strings to 2dp', () => {
    expect(normalizeMoney('1234.5')).toBe('1234.50')
    expect(normalizeMoney('0.1')).toBe('0.10')
    expect(normalizeMoney('1000')).toBe('1000.00')
    expect(() => normalizeMoney('1234.567')).toThrow(MoneyError) // never silently lose precision (PRD §17)
  })

  it('parses amounts to exact cents', () => {
    expect(moneyToCents('1234.56')).toBe(123456n)
    expect(moneyToCents('0.10')).toBe(10n)
    expect(moneyToCents('1000')).toBe(100000n)
  })

  it('adds/subtracts exactly where floats would drift (0.1 + 0.2)', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30')
    expect(addMoney('0.1', '0.2')).toBe('0.30')
    expect(subMoney('1.00', '0.90')).toBe('0.10')
    // the classic float trap: 0.1 + 0.2 !== 0.3 in IEEE754
    expect(0.1 + 0.2).not.toBe(0.3)
  })

  it('round-trips cents', () => {
    expect(centsToMoney(123456n)).toBe('1234.56')
    expect(centsToMoney(-5n)).toBe('-0.05')
    expect(moneyToCents(centsToMoney(999999999n))).toBe(999999999n)
  })

  it('compares money precisely', () => {
    expect(cmpMoney('1.10', '1.1')).toBe(0)
    expect(cmpMoney('1.01', '1.1')).toBe(-1)
    expect(cmpMoney('2', '1.99')).toBe(1)
  })

  it('validates positivity', () => {
    expect(isPositiveMoney('0.01')).toBe(true)
    expect(isPositiveMoney('0')).toBe(false)
    expect(isPositiveMoney('-1')).toBe(false)
  })

  it('rejects malformed amounts with MoneyError', () => {
    expect(() => moneyToCents('abc')).toThrow(MoneyError)
    expect(() => moneyToCents('1.234')).toThrow(MoneyError)
    expect(() => normalizeMoney('')).toThrow(MoneyError)
  })
})
