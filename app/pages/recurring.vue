<script setup lang="ts">
import type { AccountDTO } from '../../server/services/accounts/service'
import type { CategoryDTO } from '../../server/services/categories/service'
import type { RecurringDTO } from '../../server/services/recurring/service'
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'
import { formatDate, formatMoney } from '../lib/format'

useHead({ title: 'Recurring · Financial OS' })

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const

const items = ref<RecurringDTO[]>([])
const accounts = ref<AccountDTO[]>([])
const categories = ref<CategoryDTO[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const showForm = ref(false)
const saving = ref(false)
const processing = ref(false)
const processResult = ref<string | null>(null)

const form = reactive({
  type: 'expense' as 'income' | 'expense',
  accountId: '',
  categoryId: '' as string | null,
  amount: '',
  description: '',
  frequency: 'monthly' as (typeof FREQUENCIES)[number],
  nextDueDate: '',
  endDate: '',
})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [recurring, accountRows, categoryRows] = await Promise.all([
      useApi<{ items: RecurringDTO[] }>('/api/recurring'),
      useApi<{ accounts: AccountDTO[] }>('/api/accounts'),
      useApi<{ categories: CategoryDTO[] }>('/api/categories'),
    ])
    items.value = recurring.items
    accounts.value = accountRows.accounts
    categories.value = categoryRows.categories
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

const formCategories = computed(() => categories.value.filter((c) => c.type === form.type))

async function create(): Promise<void> {
  saving.value = true
  error.value = null
  try {
    await useApi('/api/recurring', {
      method: 'POST',
      body: {
        type: form.type,
        accountId: form.accountId,
        categoryId: form.categoryId || undefined,
        amount: form.amount,
        description: form.description || undefined,
        frequency: form.frequency,
        nextDueDate: form.nextDueDate,
        endDate: form.endDate || undefined,
      },
    })
    showForm.value = false
    form.amount = ''
    form.description = ''
    form.endDate = ''
    await load()
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    saving.value = false
  }
}

async function toggle(item: RecurringDTO): Promise<void> {
  try {
    await useApi(`/api/recurring/${item.id}`, { method: 'PATCH', body: { isActive: !item.isActive } })
    await load()
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  }
}

async function remove(item: RecurringDTO): Promise<void> {
  try {
    await useApi(`/api/recurring/${item.id}`, { method: 'DELETE' })
    await load()
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  }
}

async function processNow(): Promise<void> {
  processing.value = true
  processResult.value = null
  error.value = null
  try {
    const result = await useApi<{ result: { created: number; skipped: number; processed: number } }>('/api/recurring/process', { method: 'POST' })
    processResult.value = `Processed ${result.result.processed} template(s): ${result.result.created} created, ${result.result.skipped} already existed.`
    await load()
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    processing.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Recurring transactions</h1>
        <p class="text-sm text-muted-foreground">
          Templates generate real transactions idempotently — running twice never duplicates (PRD §32).
        </p>
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          :disabled="processing"
          class="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          @click="processNow"
        >
          {{ processing ? 'Processing…' : 'Generate due' }}
        </button>
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          @click="showForm = !showForm"
        >
          {{ showForm ? 'Close' : 'New recurring' }}
        </button>
      </div>
    </header>

    <p v-if="processResult" class="rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground" role="status">
      {{ processResult }}
    </p>

    <form v-if="showForm" class="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3" @submit.prevent="create">
      <label class="space-y-1">
        <span class="text-xs text-muted-foreground">Type</span>
        <select v-model="form.type" class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
      </label>
      <label class="space-y-1">
        <span class="text-xs text-muted-foreground">Account</span>
        <select v-model="form.accountId" required class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </label>
      <label class="space-y-1">
        <span class="text-xs text-muted-foreground">Category</span>
        <select v-model="form.categoryId" class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
          <option :value="null">— none —</option>
          <option v-for="c in formCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <label class="space-y-1">
        <span class="text-xs text-muted-foreground">Amount (IDR)</span>
        <input v-model="form.amount" required type="text" inputmode="decimal" placeholder="500000" class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
      </label>
      <label class="space-y-1">
        <span class="text-xs text-muted-foreground">Frequency</span>
        <select v-model="form.frequency" class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
          <option v-for="f in FREQUENCIES" :key="f" :value="f">{{ f }}</option>
        </select>
      </label>
      <label class="space-y-1">
        <span class="text-xs text-muted-foreground">Next due date</span>
        <input v-model="form.nextDueDate" required type="date" class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
      </label>
      <label class="space-y-1 sm:col-span-2">
        <span class="text-xs text-muted-foreground">Description</span>
        <input v-model="form.description" type="text" class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
      </label>
      <label class="space-y-1">
        <span class="text-xs text-muted-foreground">End date (optional)</span>
        <input v-model="form.endDate" type="date" class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
      </label>
      <div class="sm:col-span-2 lg:col-span-3">
        <button type="submit" :disabled="saving" class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
          {{ saving ? 'Saving…' : 'Create recurring' }}
        </button>
      </div>
    </form>

    <UiStateBlock :loading="loading" :error="error" :empty="!items.length" empty-title="No recurring transactions" empty-description="Create a template to automate salaries, rent or subscriptions." @retry="load">
      <ul class="space-y-2">
        <li v-for="item in items" :key="item.id" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">
              {{ item.description || item.categoryName || (item.type === 'income' ? 'Income' : 'Expense') }}
              <span class="ml-1 text-xs font-normal text-muted-foreground">· {{ item.frequency }}</span>
            </p>
            <p class="text-xs text-muted-foreground">
              {{ item.accountName }}<template v-if="item.categoryName"> · {{ item.categoryName }}</template>
              · next {{ formatDate(item.nextDueDate) }}<template v-if="item.endDate"> · until {{ formatDate(item.endDate) }}</template>
            </p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold tabular-nums" :class="item.type === 'income' ? 'text-emerald-500' : 'text-rose-500'">
              {{ item.type === 'income' ? '+' : '−' }}{{ formatMoney(item.amount) }}
            </span>
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              :class="item.isActive ? 'border-emerald-500/30 text-emerald-500' : 'border-border text-muted-foreground'"
            >
              {{ item.isActive ? 'active' : 'paused' }}
            </span>
            <button type="button" class="text-xs font-medium text-muted-foreground hover:text-foreground" @click="toggle(item)">
              {{ item.isActive ? 'Pause' : 'Resume' }}
            </button>
            <button type="button" class="text-xs font-medium text-rose-500 hover:underline" @click="remove(item)">
              Delete
            </button>
          </div>
        </li>
      </ul>
    </UiStateBlock>
  </div>
</template>
