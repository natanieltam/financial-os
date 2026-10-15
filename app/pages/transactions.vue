<script setup lang="ts">
import type { AccountDTO } from '../../server/services/accounts/service'
import type { CategoryDTO } from '../../server/services/categories/service'
import type { TransactionDTO, TransactionListResult } from '../../server/services/transactions/service'
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'
import { formatDate, formatMoney } from '../lib/format'

useHead({ title: 'Transactions \u00b7 Financial OS' })

const list = ref<TransactionListResult | null>(null)
const accounts = ref<AccountDTO[]>([])
const categories = ref<CategoryDTO[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const showForm = ref(false)
const editing = ref<TransactionDTO | null>(null)
const deletingId = ref<string | null>(null)

const filters = reactive({
  page: 1,
  pageSize: 15,
  type: '' as '' | 'income' | 'expense' | 'transfer',
  accountId: '',
  categoryId: '',
  search: '',
  from: '',
  to: '',
})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [txResult, accountRows, categoryRows] = await Promise.all([
      useApi<TransactionListResult>('/api/transactions', {
        query: {
          page: filters.page,
          pageSize: filters.pageSize,
          type: filters.type || undefined,
          accountId: filters.accountId || undefined,
          categoryId: filters.categoryId || undefined,
          search: filters.search || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
        },
      }),
      useApi<{ accounts: AccountDTO[] }>('/api/accounts'),
      useApi<{ categories: CategoryDTO[] }>('/api/categories'),
    ])
    list.value = txResult
    accounts.value = accountRows.accounts
    categories.value = categoryRows.categories
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

watch(
  () => [filters.type, filters.accountId, filters.categoryId, filters.from, filters.to],
  () => {
    filters.page = 1
    void load()
  },
)

const totalPages = computed(() =>
  list.value ? Math.max(1, Math.ceil(list.value.total / list.value.pageSize)) : 1,
)

function startEdit(tx: TransactionDTO): void {
  editing.value = tx
  showForm.value = true
}

async function remove(tx: TransactionDTO): Promise<void> {
  deletingId.value = tx.id
  try {
    await useApi(`/api/transactions/${tx.id}`, { method: 'DELETE' })
    await load()
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Transactions</h1>
        <p class="text-sm text-muted-foreground">
          <template v-if="list">{{ list.total }} transactions \u00b7 {{ formatMoney(list.summary.income) }} in / {{ formatMoney(list.summary.expense) }} out</template>
          <template v-else>Loading\u2026</template>
        </p>
      </div>
      <button
        type="button"
        class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        @click="editing = null; showForm = !showForm"
      >
        {{ showForm ? 'Close' : 'New transaction' }}
      </button>
    </header>

    <TransactionsTransactionForm
      v-if="showForm"
      :accounts="accounts"
      :categories="categories"
      :editing="editing"
      @saved="showForm = false; editing = null; load()"
      @cancelled="showForm = false; editing = null"
    />

    <!-- Filters -->
    <div class="grid gap-2 rounded-xl border border-border bg-card p-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
      <select v-model="filters.type" class="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
        <option value="">All types</option>
        <option value="income">Income</option>
        <option value="expense">Expense</option>
        <option value="transfer">Transfer</option>
      </select>
      <select v-model="filters.accountId" class="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
        <option value="">All accounts</option>
        <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
      <select v-model="filters.categoryId" class="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
        <option value="">All categories</option>
        <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <input v-model="filters.from" type="date" class="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm" aria-label="From date" />
      <input v-model="filters.to" type="date" class="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm" aria-label="To date" />
      <input
        v-model="filters.search"
        placeholder="Search\u2026"
        class="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
        @keyup.enter="filters.page = 1; load()"
        @blur="filters.page = 1; load()"
      />
    </div>

    <UiStateBlock :loading="loading" :error="error" :empty="!!list && list.transactions.length === 0" empty-title="No transactions found" empty-description="Adjust the filters or add your first transaction." @retry="load">
      <template v-if="list" #empty-action>
        <button type="button" class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" @click="showForm = true">
          Add transaction
        </button>
      </template>
      <template v-if="list">
        <div class="overflow-x-auto rounded-xl border border-border bg-card">
          <table class="w-full min-w-[640px] text-sm">
            <thead>
              <tr class="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th class="px-4 py-2.5 font-medium">Date</th>
                <th class="px-4 py-2.5 font-medium">Description</th>
                <th class="px-4 py-2.5 font-medium">Account</th>
                <th class="px-4 py-2.5 font-medium">Category</th>
                <th class="px-4 py-2.5 text-right font-medium">Amount</th>
                <th class="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr v-for="tx in list.transactions" :key="tx.id" class="transition-colors hover:bg-secondary/40">
                <td class="whitespace-nowrap px-4 py-3 text-muted-foreground tabular-nums">{{ formatDate(tx.transactionDate) }}</td>
                <td class="max-w-[240px] px-4 py-3">
                  <p class="truncate font-medium">{{ tx.description || tx.merchant || tx.type }}</p>
                  <p v-if="tx.merchant && tx.description" class="truncate text-xs text-muted-foreground">{{ tx.merchant }}</p>
                </td>
                <td class="px-4 py-3 text-muted-foreground">
                  {{ tx.accountName }}<template v-if="tx.type === 'transfer' && tx.toAccountName"> \u2192 {{ tx.toAccountName }}</template>
                </td>
                <td class="px-4 py-3 text-muted-foreground">{{ tx.categoryName ?? '\u2014' }}</td>
                <td
                  class="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums"
                  :class="tx.type === 'income' ? 'text-emerald-400' : tx.type === 'expense' ? 'text-red-400' : 'text-muted-foreground'"
                >
                  {{ tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : '' }}{{ formatMoney(tx.amount) }}
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-right">
                  <button type="button" class="text-xs text-muted-foreground hover:text-foreground" @click="startEdit(tx)">Edit</button>
                  <button
                    type="button"
                    class="ml-3 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
                    :disabled="deletingId === tx.id"
                    @click="remove(tx)"
                  >
                    {{ deletingId === tx.id ? 'Deleting\u2026' : 'Delete' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between pt-3 text-sm text-muted-foreground">
          <span>Page {{ list.page }} of {{ totalPages }}</span>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              :disabled="list.page <= 1"
              @click="filters.page -= 1; load()"
            >
              Previous
            </button>
            <button
              type="button"
              class="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              :disabled="list.page >= totalPages"
              @click="filters.page += 1; load()"
            >
              Next
            </button>
          </div>
        </div>
      </template>
    </UiStateBlock>
  </div>
</template>
