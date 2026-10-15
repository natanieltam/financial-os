import { describe, expect, it } from 'vitest'
import { addPeriods, budgetItemStatus, budgetPercent, computeBudgetWindow } from '../server/services/budgets/window'
import { computeProjection } from '../server/services/goals/projection'

describe('budget windows are deterministic (PRD §29–§30)', () => {
  it('monthly windows clamp the day for shorter months', () => {
    const start = new Date('2026-01-31T00:00:00.000Z')
    const feb = addPeriods(start, 'monthly', 1)
    expect(feb.toISOString().slice(0, 10)).toBe('2026-02-28')
    const mar = addPeriods(start, 'monthly', 2)
    expect(mar.toISOString().slice(0, 10)).toBe('2026-03-31')
  })

  it('fixed range budget uses its exact inclusive window', () => {
    const w = computeBudgetWindow('monthly', '2026-01-01', '2026-03-31', new Date('2026-02-10T00:00:00.000Z'))
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-04-01') // exclusive bound after inclusive end
  })

  it('rolling monthly budget finds the window containing asOf', () => {
    const w = computeBudgetWindow('monthly', '2026-01-15', null, new Date('2026-03-20T00:00:00.000Z'))
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-03-15')
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-04-15')
  })

  it('weekly windows step 7 days from the anchor', () => {
    const w = computeBudgetWindow('weekly', '2026-01-01', null, new Date('2026-01-10T00:00:00.000Z'))
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-01-08')
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-01-15')
  })

  it('budget status thresholds: <75% healthy, 75–100% warning, >100% exceeded', () => {
    expect(budgetItemStatus(749_999n, 1_000_000n)).toBe('healthy')
    expect(budgetItemStatus(750_000n, 1_000_000n)).toBe('warning')
    expect(budgetItemStatus(1_000_000n, 1_000_000n)).toBe('warning')
    expect(budgetItemStatus(1_000_001n, 1_000_000n)).toBe('exceeded')
    expect(budgetItemStatus(1n, 0n)).toBe('exceeded')
  })

  it('budget percent is computed on BigInts', () => {
    expect(budgetPercent(500_000n, 1_000_000n)).toBe(50)
    expect(budgetPercent(1n, 3n)).toBe(33.33)
    expect(budgetPercent(100n, 0n)).toBe(100)
  })
})

describe('goal projection is deterministic (PRD §31)', () => {
  const today = new Date('2026-01-01T00:00:00.000Z')

  it('ceil of remaining / monthlyContribution', () => {
    const r = computeProjection({
      targetCents: 100_000_000n,
      currentCents: 20_000_000n,
      monthlyContributionCents: 10_000_000n,
      today,
      deadline: null,
    })
    expect(r.remaining).toBe('800000.00')
    expect(r.monthsNeeded).toBe(8)
    expect(r.completed).toBe(false)
    expect(r.progressPercent).toBe(20)
    expect(r.estimatedCompletion).toBe('2026-09-01')
  })

  it('rounds partial months up', () => {
    const r = computeProjection({
      targetCents: 100_000n,
      currentCents: 0n,
      monthlyContributionCents: 30_000n,
      today,
      deadline: null,
    })
    expect(r.monthsNeeded).toBe(4) // 3.33 → 4
  })

  it('marks completed when target reached', () => {
    const r = computeProjection({
      targetCents: 5_000_000n,
      currentCents: 5_000_000n,
      monthlyContributionCents: 0n,
      today,
      deadline: null,
    })
    expect(r.completed).toBe(true)
    expect(r.monthsNeeded).toBe(0)
    expect(r.remaining).toBe('0.00')
    expect(r.progressPercent).toBe(100)
  })

  it('required monthly by deadline is ceil(remaining / monthsLeft)', () => {
    const r = computeProjection({
      targetCents: 12_000_000n,
      currentCents: 0n,
      monthlyContributionCents: 0n,
      today,
      deadline: '2026-12-31',
    })
    // Jan 1 → Dec 31 = 11 full months + day diff → monthsBetween returns 12
    expect(r.requiredMonthlyByDeadline).toBe('10000.00') // 12.000.000 cents / 12 months
  })

  it('no monthly contribution and no deadline → nulls, zero months', () => {
    const r = computeProjection({
      targetCents: 1_000_000n,
      currentCents: 0n,
      monthlyContributionCents: 0n,
      today,
      deadline: null,
    })
    expect(r.monthsNeeded).toBe(0)
    expect(r.estimatedCompletion).toBeNull()
    expect(r.requiredMonthlyByDeadline).toBeNull()
  })
})
