import { and, desc, eq, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { getDatabase } from '../../../db/client'
import { goals } from '../../../db/schema/index'
import type { GoalCreateInput, GoalUpdateInput } from '../../../shared/schemas/finance'
import { centsToString, computeProjection, moneyToCentsInput } from './projection'
import { apiErrors } from '../../utils/api'
import { audit } from '../../utils/audit'

/** Financial goals (PRD §30–§31): CRUD + deterministic progress/projection. */

export interface GoalDTO {
  id: string
  name: string
  targetAmount: string
  currentAmount: string
  deadline: string | null
  status: string
  progressPercent: number
  remainingAmount: string
  createdAt: string
  updatedAt: string
}

type GoalRow = typeof goals.$inferSelect

function toDTO(row: GoalRow): GoalDTO {
  const target = moneyToCentsInput(row.targetAmount)
  const current = moneyToCentsInput(row.currentAmount)
  const projection = computeProjection({
    targetCents: target,
    currentCents: current,
    monthlyContributionCents: 0n,
    today: new Date(),
    deadline: null,
  })
  return {
    id: row.id,
    name: row.name,
    targetAmount: row.targetAmount,
    currentAmount: row.currentAmount,
    deadline: row.deadline,
    status: row.status,
    progressPercent: projection.progressPercent,
    remainingAmount: centsToString(
      target > current ? target - current : 0n,
    ),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function getOwnedGoal(userId: string, goalId: string): Promise<GoalRow> {
  const rows = await getDatabase()
    .select()
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw apiErrors.notFound('Goal not found')
  return row
}

export async function getGoal(userId: string, goalId: string): Promise<GoalDTO> {
  return toDTO(await getOwnedGoal(userId, goalId))
}

/** Auto-complete when the target is reached (PRD §30). */
function resolveStatus(row: { targetAmount: string; currentAmount: string; status: string }): string {
  if (row.status === 'archived') return 'archived'
  return moneyToCentsInput(row.currentAmount) >= moneyToCentsInput(row.targetAmount)
    ? 'completed'
    : 'active'
}

export async function listGoals(
  userId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<GoalDTO[]> {
  const filters = [eq(goals.userId, userId)]
  if (!opts.includeArchived) filters.push(sql`${goals.status} <> 'archived'`)
  const rows = await getDatabase()
    .select()
    .from(goals)
    .where(and(...filters))
    .orderBy(desc(goals.createdAt))
  return rows.map(toDTO)
}

export async function createGoal(
  event: H3Event,
  userId: string,
  input: GoalCreateInput,
): Promise<GoalDTO> {
  const draft = {
    targetAmount: input.targetAmount,
    currentAmount: input.currentAmount ?? '0',
    status: 'active',
  }
  const inserted = await getDatabase()
    .insert(goals)
    .values({
      userId,
      name: input.name,
      targetAmount: draft.targetAmount,
      currentAmount: draft.currentAmount,
      deadline: input.deadline ?? null,
      status: resolveStatus(draft) as GoalRow['status'],
    })
    .returning()
  const row = inserted[0]
  if (!row) throw apiErrors.internal()
  await audit(event, 'goal_created', {
    userId,
    entityType: 'goal',
    entityId: row.id,
    metadata: { target: row.targetAmount },
  })
  return toDTO(row)
}

export async function updateGoal(
  event: H3Event,
  userId: string,
  goalId: string,
  input: GoalUpdateInput,
): Promise<GoalDTO> {
  const existing = await getOwnedGoal(userId, goalId)
  const next = {
    targetAmount: input.targetAmount ?? existing.targetAmount,
    currentAmount: input.currentAmount ?? existing.currentAmount,
    status: input.status ?? existing.status,
  }
  const computedStatus = input.status === 'archived' ? 'archived' : resolveStatus(next)
  const updated = await getDatabase()
    .update(goals)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.targetAmount !== undefined ? { targetAmount: input.targetAmount } : {}),
      ...(input.currentAmount !== undefined ? { currentAmount: input.currentAmount } : {}),
      ...(input.deadline !== undefined ? { deadline: input.deadline ?? null } : {}),
      status: computedStatus as GoalRow['status'],
      updatedAt: new Date(),
    })
    .where(and(eq(goals.id, existing.id), eq(goals.userId, userId)))
    .returning()
  const row = updated[0]
  if (!row) throw apiErrors.notFound('Goal not found')
  await audit(event, 'goal_updated', {
    userId,
    entityType: 'goal',
    entityId: row.id,
    metadata: { fields: Object.keys(input), status: row.status },
  })
  return toDTO(row)
}

/** Soft delete (PRD §22 data strategy): history retained, list hidden. */
export async function deleteGoal(
  event: H3Event,
  userId: string,
  goalId: string,
): Promise<{ deleted: true; id: string }> {
  const existing = await getOwnedGoal(userId, goalId)
  await getDatabase()
    .update(goals)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(and(eq(goals.id, existing.id), eq(goals.userId, userId)))
  await audit(event, 'goal_deleted', {
    userId,
    entityType: 'goal',
    entityId: existing.id,
  })
  return { deleted: true, id: existing.id }
}

/** What-if simulation (PRD §31) — deterministic, never AI. */
export async function projectGoal(
  userId: string,
  goalId: string,
  monthlyContribution: string,
): Promise<ReturnType<typeof computeProjection>> {
  const row = await getOwnedGoal(userId, goalId)
  return computeProjection({
    targetCents: moneyToCentsInput(row.targetAmount),
    currentCents: moneyToCentsInput(row.currentAmount),
    monthlyContributionCents: moneyToCentsInput(monthlyContribution),
    today: new Date(),
    deadline: row.deadline,
  })
}
