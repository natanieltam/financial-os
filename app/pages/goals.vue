<script setup lang="ts">
import type { GoalDTO } from '../../server/services/goals/service'
import type { ProjectionResult } from '../../server/services/goals/projection'
import { goalCreateSchema } from '#shared/schemas/finance'
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'
import { formatDate, formatMoney, percent } from '../lib/format'

useHead({ title: 'Goals \u00b7 Financial OS' })

const goals = ref<GoalDTO[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)
const showForm = ref(false)
const pending = ref(false)
const deletingId = ref<string | null>(null)
const editingId = ref<string | null>(null)

const projectionLoading = reactive<Record<string, boolean>>({})
const projectionResult = reactive<Record<string, ProjectionResult | null>>({})
const monthlyInput = reactive<Record<string, string>>({})

const form = reactive({
  name: '',
  targetAmount: '',
  currentAmount: '0',
  deadline: '',
  status: 'active',
})
const fieldErrors = reactive<Record<string, string>>({})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await useApi<{ goals: GoalDTO[] }>('/api/goals')
    goals.value = result.goals
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function submit(): Promise<void> {
  for (const key of Object.keys(fieldErrors)) fieldErrors[key] = ''
  actionError.value = null
  const body = {
    name: form.name,
    targetAmount: form.targetAmount,
    currentAmount: form.currentAmount || '0',
    deadline: form.deadline || undefined,
    status: form.status,
  }
  const parsed = goalCreateSchema.safeParse(body)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? 'form')] = issue.message
    return
  }
  pending.value = true
  try {
    const url = editingId.value ? `/api/goals/${editingId.value}` : '/api/goals'
    await useApi(url, { method: editingId.value ? 'PATCH' : 'POST', body: parsed.data })
    showForm.value = false
    editingId.value = null
    resetForm()
    await load()
  } catch (err) {
    actionError.value = apiErrorMessage(toRequestError(err))
  } finally {
    pending.value = false
  }
}

function resetForm(): void {
  form.name = ''
  form.targetAmount = ''
  form.currentAmount = '0'
  form.deadline = ''
  form.status = 'active'
}

function startEdit(goal: GoalDTO): void {
  editingId.value = goal.id
  form.name = goal.name
  form.targetAmount = goal.targetAmount
  form.currentAmount = goal.currentAmount
  form.deadline = goal.deadline ?? ''
  form.status = goal.status
  showForm.value = true
}

async function remove(goal: GoalDTO): Promise<void> {
  deletingId.value = goal.id
  actionError.value = null
  try {
    await useApi(`/api/goals/${goal.id}`, { method: 'DELETE' })
    await load()
  } catch (err) {
    actionError.value = apiErrorMessage(toRequestError(err))
  } finally {
    deletingId.value = null
  }
}

async function simulate(goal: GoalDTO): Promise<void> {
  projectionLoading[goal.id] = true
  try {
    const monthly = monthlyInput[goal.id] ?? ''
    projectionResult[goal.id] = await useApi<ProjectionResult>(`/api/goals/${goal.id}/projection`, {
      query: { monthlyContribution: monthly || undefined },
    })
  } catch (err) {
    actionError.value = apiErrorMessage(toRequestError(err))
  } finally {
    projectionLoading[goal.id] = false
  }
}

function barTone(progress: number): string {
  return progress >= 100 ? 'bg-emerald-400' : progress >= 40 ? 'bg-indigo-400' : 'bg-amber-400'
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Goals</h1>
        <p class="text-sm text-muted-foreground">What-if projections are computed deterministically on the server</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        @click="showForm = !showForm; editingId = null; resetForm()"
      >
        {{ showForm ? 'Close' : 'New goal' }}
      </button>
    </header>

    <form v-if="showForm" class="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-5" novalidate @submit.prevent="submit">
      <div>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
        <input v-model="form.name" placeholder="e.g. Emergency fund" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        <p v-if="fieldErrors.name" class="mt-1 text-xs text-destructive">{{ fieldErrors.name }}</p>
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Target</label>
        <input v-model="form.targetAmount" inputmode="decimal" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums" />
        <p v-if="fieldErrors.targetAmount" class="mt-1 text-xs text-destructive">{{ fieldErrors.targetAmount }}</p>
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Current</label>
        <input v-model="form.currentAmount" inputmode="decimal" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums" />
        <p v-if="fieldErrors.currentAmount" class="mt-1 text-xs text-destructive">{{ fieldErrors.currentAmount }}</p>
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Deadline</label>
        <input v-model="form.deadline" type="date" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        <p v-if="fieldErrors.deadline" class="mt-1 text-xs text-destructive">{{ fieldErrors.deadline }}</p>
      </div>
      <div class="flex items-end">
        <button type="submit" :disabled="pending" class="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {{ pending ? 'Saving\u2026' : editingId ? 'Save' : 'Create' }}
        </button>
      </div>
      <p v-if="actionError" class="text-sm text-destructive sm:col-span-5" role="alert">{{ actionError }}</p>
    </form>

    <UiStateBlock :loading="loading" :error="error" :empty="goals.length === 0" empty-title="No goals yet" empty-description="Create a savings goal to track progress toward a target." @retry="load">
      <template #empty-action>
        <button type="button" class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" @click="showForm = true">
          New goal
        </button>
      </template>

      <div class="grid gap-4 lg:grid-cols-2">
        <article v-for="goal in goals" :key="goal.id" class="rounded-xl border border-border bg-card p-4">
          <div class="flex items-start justify-between">
            <div>
              <h2 class="text-sm font-semibold">{{ goal.name }}</h2>
              <p class="text-xs text-muted-foreground">
                {{ formatMoney(goal.currentAmount) }} of {{ formatMoney(goal.targetAmount) }}
                <template v-if="goal.deadline"> \u00b7 due {{ formatDate(goal.deadline) }}</template>
              </p>
            </div>
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              :class="goal.status === 'completed' ? 'border-emerald-500/30 text-emerald-400' : 'border-border text-muted-foreground'"
            >
              {{ goal.status }}
            </span>
          </div>

          <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              class="h-full rounded-full transition-all"
              :class="barTone(goal.progressPercent)"
              :style="{ width: `${Math.min(100, Math.max(0, goal.progressPercent))}%` }"
            />
          </div>
          <div class="mt-1.5 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
            <span>{{ percent(goal.progressPercent) }}</span>
            <span v-if="goal.status === 'active'">{{ formatMoney(goal.remainingAmount) }} to go</span>
          </div>

          <!-- What-if simulator -->
          <div class="mt-4 rounded-lg border border-border bg-background/40 p-3">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">What-if simulator</p>
            <div class="mt-2 flex gap-2">
              <input
                v-model="monthlyInput[goal.id]"
                inputmode="decimal"
                placeholder="Monthly contribution"
                class="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums"
              />
              <button
                type="button"
                class="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
                :disabled="projectionLoading[goal.id]"
                @click="simulate(goal)"
              >
                {{ projectionLoading[goal.id] ? 'Computing\u2026' : 'Simulate' }}
              </button>
            </div>
            <template v-if="projectionResult[goal.id]">
              <div v-if="projectionResult[goal.id]!.completed" class="mt-2 text-xs text-emerald-400">
                Target already reached \u2014 nothing left to save.
              </div>
              <div v-else class="mt-2 space-y-0.5 text-xs text-muted-foreground tabular-nums">
                <p v-if="projectionResult[goal.id]!.monthsNeeded <= 0 && !projectionResult[goal.id]!.estimatedCompletion">
                  Enter a monthly contribution to estimate the timeline.
                </p>
                <template v-else>
                  <p>Reach target in <span class="text-foreground">{{ projectionResult[goal.id]!.monthsNeeded }} months</span></p>
                  <p v-if="projectionResult[goal.id]!.estimatedCompletion">Estimated completion: {{ formatDate(projectionResult[goal.id]!.estimatedCompletion) }}</p>
                </template>
                <p v-if="projectionResult[goal.id]!.requiredMonthlyByDeadline">
                  Required by deadline: <span class="text-foreground">{{ formatMoney(projectionResult[goal.id]!.requiredMonthlyByDeadline) }}</span>/month
                </p>
              </div>
            </template>
          </div>

          <div class="mt-4 flex items-center justify-end gap-3 text-xs">
            <button type="button" class="text-muted-foreground hover:text-foreground" @click="startEdit(goal)">Edit</button>
            <button
              type="button"
              class="text-muted-foreground hover:text-destructive disabled:opacity-50"
              :disabled="deletingId === goal.id"
              @click="remove(goal)"
            >
              {{ deletingId === goal.id ? 'Deleting\u2026' : 'Delete' }}
            </button>
          </div>
        </article>
      </div>
    </UiStateBlock>
  </div>
</template>
