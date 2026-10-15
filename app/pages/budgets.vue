<script setup lang="ts">
import type { BudgetDTO } from '../../server/services/budgets/service'
import type { CategoryDTO } from '../../server/services/categories/service'
import { budgetCreateSchema } from '#shared/schemas/finance'
import { BUDGET_PERIODS } from '#shared/constants/finance'
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'
import { formatDate, formatMoney, percent } from '../lib/format'

useHead({ title: 'Budgets \u00b7 Financial OS' })

const budgets = ref<BudgetDTO[]>([])
const categories = ref<CategoryDTO[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)
const showForm = ref(false)
const pending = ref(false)
const archivingId = ref<string | null>(null)

const form = reactive({
  name: '',
  period: 'monthly' as string,
  startDate: new Date().toISOString().slice(0, 10),
  items: [] as Array<{ categoryId: string; amount: string }>,
})
const fieldErrors = reactive<Record<string, string>>({})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [budgetResult, categoryResult] = await Promise.all([
      useApi<{ budgets: BudgetDTO[] }>('/api/budgets'),
      useApi<{ categories: CategoryDTO[] }>('/api/categories'),
    ])
    budgets.value = budgetResult.budgets
    categories.value = categoryResult.categories.filter((c) => c.type === 'expense' && !c.isArchived)
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

function addItem(): void {
  form.items.push({ categoryId: '', amount: '' })
}

async function create(): Promise<void> {
  for (const key of Object.keys(fieldErrors)) fieldErrors[key] = ''
  actionError.value = null
  const parsed = budgetCreateSchema.safeParse({
    name: form.name,
    period: form.period,
    startDate: form.startDate,
    items: form.items.filter((i) => i.categoryId && i.amount),
  })
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? 'form')] = issue.message
    return
  }
  pending.value = true
  try {
    await useApi('/api/budgets', { method: 'POST', body: parsed.data })
    showForm.value = false
    form.name = ''
    form.items = []
    await load()
  } catch (err) {
    actionError.value = apiErrorMessage(toRequestError(err))
  } finally {
    pending.value = false
  }
}

async function archive(budget: BudgetDTO): Promise<void> {
  archivingId.value = budget.id
  actionError.value = null
  try {
    await useApi(`/api/budgets/${budget.id}`, { method: 'DELETE' })
    await load()
  } catch (err) {
    actionError.value = apiErrorMessage(toRequestError(err))
  } finally {
    archivingId.value = null
  }
}

function tone(status: string): string {
  return status === 'exceeded' ? 'text-red-400' : status === 'warning' ? 'text-amber-400' : 'text-emerald-400'
}

function barTone(status: string): string {
  return status === 'exceeded' ? 'bg-red-400' : status === 'warning' ? 'bg-amber-400' : 'bg-emerald-400'
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Budgets</h1>
        <p class="text-sm text-muted-foreground">Per-category limits per period \u00b7 spending is read live from transactions</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        @click="showForm = !showForm"
      >
        {{ showForm ? 'Close' : 'New budget' }}
      </button>
    </header>

    <form v-if="showForm" class="space-y-4 rounded-xl border border-border bg-card p-4" novalidate @submit.prevent="create">
      <div class="grid gap-3 sm:grid-cols-3">
        <div>
          <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
          <input v-model="form.name" placeholder="e.g. October budget" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <p v-if="fieldErrors.name" class="mt-1 text-xs text-destructive">{{ fieldErrors.name }}</p>
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Period</label>
          <select v-model="form.period" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option v-for="p in BUDGET_PERIODS" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Start date</label>
          <input v-model="form.startDate" type="date" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <p v-if="fieldErrors.startDate" class="mt-1 text-xs text-destructive">{{ fieldErrors.startDate }}</p>
        </div>
      </div>

      <div>
        <div class="mb-2 flex items-center justify-between">
          <label class="text-xs font-medium text-muted-foreground">Category allocations</label>
          <button type="button" class="text-xs text-muted-foreground hover:text-foreground" @click="addItem">+ Add category</button>
        </div>
        <div v-for="(item, index) in form.items" :key="index" class="mb-2 flex gap-2">
          <select v-model="item.categoryId" class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="" disabled>Select category</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <input
            v-model="item.amount"
            inputmode="decimal"
            placeholder="Amount"
            class="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums"
          />
          <button type="button" class="text-xs text-muted-foreground hover:text-destructive" @click="form.items.splice(index, 1)">Remove</button>
        </div>
        <p v-if="fieldErrors.items" class="text-xs text-destructive">{{ fieldErrors.items }}</p>
        <p class="text-[11px] text-muted-foreground">A budget without allocations tracks nothing \u2014 add at least one category.</p>
      </div>

      <p v-if="actionError" class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
        {{ actionError }}
      </p>

      <div class="flex justify-end">
        <button type="submit" :disabled="pending" class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {{ pending ? 'Saving\u2026' : 'Create budget' }}
        </button>
      </div>
    </form>

    <UiStateBlock :loading="loading" :error="error" :empty="budgets.length === 0" empty-title="No budgets yet" empty-description="Create a budget to set per-category spending limits." @retry="load">
      <template #empty-action>
        <button type="button" class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" @click="showForm = true">
          New budget
        </button>
      </template>

      <div class="space-y-4">
        <article v-for="budget in budgets" :key="budget.id" class="rounded-xl border border-border bg-card p-4">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 class="text-sm font-semibold">{{ budget.name }}</h2>
              <p class="text-xs text-muted-foreground">
                {{ budget.period }} \u00b7 {{ formatDate(budget.window.start) }} \u2013 {{ formatDate(budget.window.end) }}
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-sm font-semibold tabular-nums" :class="tone(budget.totals.status)">{{ percent(budget.totals.percent) }}</span>
              <button
                type="button"
                class="text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
                :disabled="archivingId === budget.id"
                @click="archive(budget)"
              >
                {{ archivingId === budget.id ? 'Archiving\u2026' : 'Archive' }}
              </button>
            </div>
          </div>

          <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              class="h-full rounded-full transition-all"
              :class="barTone(budget.totals.status)"
              :style="{ width: `${Math.min(100, Math.max(0, budget.totals.percent))}%` }"
            />
          </div>
          <p class="mt-1.5 text-xs text-muted-foreground tabular-nums">
            {{ formatMoney(budget.totals.spent) }} of {{ formatMoney(budget.totals.budgeted) }} spent \u00b7 {{ formatMoney(budget.totals.remaining) }} remaining
          </p>

          <ul v-if="budget.items.length" class="mt-4 divide-y divide-border border-t border-border">
            <li v-for="item in budget.items" :key="item.id" class="flex items-center justify-between gap-4 py-2.5">
              <div class="flex min-w-0 items-center gap-2.5">
                <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: item.categoryColor ?? '#52525b' }" />
                <span class="truncate text-sm">{{ item.categoryName }}</span>
              </div>
              <div class="flex shrink-0 items-center gap-4 text-xs tabular-nums">
                <span class="text-muted-foreground">{{ formatMoney(item.spent) }} / {{ formatMoney(item.amount) }}</span>
                <span class="w-12 text-right font-semibold" :class="tone(item.status)">{{ percent(item.percent) }}</span>
              </div>
            </li>
          </ul>
        </article>
      </div>
    </UiStateBlock>
  </div>
</template>
