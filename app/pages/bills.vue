<script setup lang="ts">
import type { AccountDTO } from '../../server/services/accounts/service'
import type { CategoryDTO } from '../../server/services/categories/service'
import type { BillDTO } from '../../server/services/bills/service'
import type { BillStatus } from '../../shared/constants/finance'
import { addMoney } from '#shared/money'
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'
import { formatDate, formatMoney } from '../lib/format'

useHead({ title: 'Bills · Financial OS' })

const STATUSES: Array<{ value: BillStatus | ''; label: string }> = [
  { value: '', label: 'All' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_soon', label: 'Due soon' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'paid', label: 'Paid' },
]

const STATUS_TONE: Record<BillStatus, string> = {
  overdue: 'border-rose-500/40 text-rose-500',
  due_soon: 'border-amber-500/40 text-amber-500',
  upcoming: 'border-border text-muted-foreground',
  paid: 'border-emerald-500/40 text-emerald-500',
}

const items = ref<BillDTO[]>([])
const accounts = ref<AccountDTO[]>([])
const categories = ref<CategoryDTO[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const filter = ref<BillStatus | ''>('')
const showForm = ref(false)
const saving = ref(false)
const payingId = ref<string | null>(null)

const form = reactive({
  name: '',
  amount: '',
  dueDate: '',
  accountId: '' as string,
  categoryId: '' as string | null,
})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [bills, accountRows, categoryRows] = await Promise.all([
      useApi<{ items: BillDTO[] }>('/api/bills', { query: filter.value ? { status: filter.value } : {} }),
      useApi<{ accounts: AccountDTO[] }>('/api/accounts'),
      useApi<{ categories: CategoryDTO[] }>('/api/categories'),
    ])
    items.value = bills.items
    accounts.value = accountRows.accounts
    categories.value = categoryRows.categories
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    loading.value = false
  }
}

watch(filter, () => void load())
onMounted(load)

const expenseCategories = computed(() => categories.value.filter((c) => c.type === 'expense'))

async function create(): Promise<void> {
  saving.value = true
  error.value = null
  try {
    await useApi('/api/bills', {
      method: 'POST',
      body: {
        name: form.name,
        amount: form.amount,
        dueDate: form.dueDate,
        accountId: form.accountId || undefined,
        categoryId: form.categoryId || undefined,
      },
    })
    showForm.value = false
    form.name = ''
    form.amount = ''
    form.dueDate = ''
    await load()
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    saving.value = false
  }
}

async function pay(bill: BillDTO): Promise<void> {
  payingId.value = bill.id
  error.value = null
  try {
    await useApi(`/api/bills/${bill.id}/pay`, { method: 'POST' })
    await load()
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    payingId.value = null
  }
}

async function remove(bill: BillDTO): Promise<void> {
  try {
    await useApi(`/api/bills/${bill.id}`, { method: 'DELETE' })
    await load()
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  }
}

const unpaidTotal = computed(() =>
  items.value.filter((b) => b.status !== 'paid').reduce((sum, b) => addMoney(sum, b.amount), '0.00'),
)
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Bills</h1>
        <p class="text-sm text-muted-foreground">
          Status is derived from the due date on every read · unpaid total {{ formatMoney(unpaidTotal) }}
        </p>
      </div>
      <button
        type="button"
        class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        @click="showForm = !showForm"
      >
        {{ showForm ? 'Close' : 'New bill' }}
      </button>
    </header>

    <form v-if="showForm" class="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3" @submit.prevent="create">
      <label class="space-y-1">
        <span class="text-xs text-muted-foreground">Name</span>
        <input v-model="form.name" required type="text" placeholder="Internet" class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
      </label>
      <label class="space-y-1">
        <span class="text-xs text-muted-foreground">Amount (IDR)</span>
        <input v-model="form.amount" required type="text" inputmode="decimal" placeholder="350000" class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
      </label>
      <label class="space-y-1">
        <span class="text-xs text-muted-foreground">Due date</span>
        <input v-model="form.dueDate" required type="date" class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
      </label>
      <label class="space-y-1">
        <span class="text-xs text-muted-foreground">Account (required to mark paid)</span>
        <select v-model="form.accountId" class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
          <option value="">— none —</option>
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </label>
      <label class="space-y-1">
        <span class="text-xs text-muted-foreground">Category</span>
        <select v-model="form.categoryId" class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
          <option :value="null">— none —</option>
          <option v-for="c in expenseCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <div class="lg:col-span-3">
        <button type="submit" :disabled="saving" class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
          {{ saving ? 'Saving…' : 'Create bill' }}
        </button>
      </div>
    </form>

    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="s in STATUSES"
        :key="s.value"
        type="button"
        class="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
        :class="filter === s.value ? 'border-border bg-secondary text-foreground' : 'border-border text-muted-foreground hover:text-foreground'"
        @click="filter = s.value"
      >
        {{ s.label }}
      </button>
    </div>

    <UiStateBlock :loading="loading" :error="error" :empty="!items.length" empty-title="No bills" empty-description="Add upcoming bills to fold them into your cashflow forecast." @retry="load">
      <ul class="space-y-2">
        <li v-for="bill in items" :key="bill.id" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">
              {{ bill.name }}
              <span class="ml-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide" :class="STATUS_TONE[bill.status]">
                {{ bill.status.replace('_', ' ') }}
              </span>
            </p>
            <p class="text-xs text-muted-foreground">
              due {{ formatDate(bill.dueDate) }}
              <template v-if="bill.accountName"> · {{ bill.accountName }}</template>
              <template v-if="bill.categoryName"> · {{ bill.categoryName }}</template>
            </p>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-sm font-semibold tabular-nums text-rose-500">−{{ formatMoney(bill.amount) }}</span>
            <button
              v-if="bill.status !== 'paid'"
              type="button"
              :disabled="payingId === bill.id"
              class="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              @click="pay(bill)"
            >
              {{ payingId === bill.id ? 'Recording…' : 'Mark paid' }}
            </button>
            <button v-else type="button" class="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground" @click="remove(bill)">
              Remove
            </button>
          </div>
        </li>
      </ul>
    </UiStateBlock>
  </div>
</template>
