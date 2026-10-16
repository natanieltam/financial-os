<script setup lang="ts">
import type {
  AccountReport,
  BudgetReport,
  CashflowReport,
  CategoryReport,
  SummaryReport,
} from '../../server/services/reports/service'
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'
import { formatDate, formatMoney, percent } from '../lib/format'

useHead({ title: 'Reports · Financial OS' })

const periods = ['7d', '30d', '90d', '1m', '3m', '6m', '1y'] as const
type Period = (typeof periods)[number]
const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90, '1m': 30, '3m': 91, '6m': 182, '1y': 365 }

const period = ref<Period>('30d')
const summary = ref<SummaryReport | null>(null)
const cashflow = ref<CashflowReport | null>(null)
const categoryReport = ref<CategoryReport | null>(null)
const accountReport = ref<AccountReport | null>(null)
const budgetReport = ref<BudgetReport | null>(null)

const loading = ref(true)
const error = ref<string | null>(null)

function periodRangeClient(p: Period): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to.getTime() - PERIOD_DAYS[p] * 86_400_000)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const range = periodRangeClient(period.value)
    const [s, c, cat, acc, bud] = await Promise.all([
      useApi<SummaryReport>('/api/reports/summary', { query: { period: period.value } }),
      useApi<CashflowReport>('/api/reports/cashflow', { query: { granularity: 'month' } }),
      useApi<CategoryReport>('/api/reports/categories', { query: { from: range.from, to: range.to } }),
      useApi<AccountReport>('/api/reports/accounts'),
      useApi<BudgetReport>('/api/reports/budgets'),
    ])
    summary.value = s
    cashflow.value = c
    categoryReport.value = cat
    accountReport.value = acc
    budgetReport.value = bud
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(period, load)

const cashflowLabels = computed(() => (cashflow.value?.points ?? []).map((p) => p.period))
const accountSlices = computed(() =>
  (accountReport.value?.accounts ?? []).map((a) => ({ name: a.name, value: Math.round(Number(a.balance)) })),
)

function changeTone(value: number | null, goodWhenDown: boolean): string {
  if (value === null) return 'text-muted-foreground'
  const good = goodWhenDown ? value < 0 : value > 0
  return good ? 'text-emerald-400' : 'text-red-400'
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Reports &amp; analytics</h1>
        <p class="text-sm text-muted-foreground">Every chart renders the exact server-computed numbers</p>
      </div>
      <div class="flex gap-1 rounded-lg border border-border p-0.5">
        <button
          v-for="p in periods"
          :key="p"
          type="button"
          class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
          :class="period === p ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="period = p"
        >
          {{ p }}
        </button>
      </div>
    </header>

    <UiStateBlock :loading="loading" :error="error" @retry="load">
      <template v-if="summary">
        <section class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div class="rounded-xl border border-border bg-card p-4">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Income ({{ summary.period }})</p>
            <p class="mt-1.5 text-2xl font-semibold tabular-nums text-emerald-400">{{ formatMoney(summary.current.income) }}</p>
            <p class="mt-0.5 text-xs tabular-nums" :class="changeTone(summary.change.incomePercent, false)">
              {{ summary.change.incomePercent === null ? 'no prior data' : `${summary.change.incomePercent > 0 ? '+' : ''}${percent(summary.change.incomePercent)} vs previous` }}
            </p>
          </div>
          <div class="rounded-xl border border-border bg-card p-4">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Expense ({{ summary.period }})</p>
            <p class="mt-1.5 text-2xl font-semibold tabular-nums text-red-400">{{ formatMoney(summary.current.expense) }}</p>
            <p class="mt-0.5 text-xs tabular-nums" :class="changeTone(summary.change.expensePercent, true)">
              {{ summary.change.expensePercent === null ? 'no prior data' : `${summary.change.expensePercent > 0 ? '+' : ''}${percent(summary.change.expensePercent)} vs previous` }}
            </p>
          </div>
          <div class="rounded-xl border border-border bg-card p-4">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Net cashflow</p>
            <p
              class="mt-1.5 text-2xl font-semibold tabular-nums"
              :class="summary.current.net.startsWith('-') ? 'text-red-400' : 'text-foreground'"
            >
              {{ formatMoney(summary.current.net) }}
            </p>
          </div>
          <div class="rounded-xl border border-border bg-card p-4">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Savings rate</p>
            <p class="mt-1.5 text-2xl font-semibold tabular-nums">{{ summary.savingsRatePercent === null ? '\u2014' : percent(summary.savingsRatePercent) }}</p>
            <p class="mt-0.5 text-xs text-muted-foreground">avg {{ formatMoney(summary.averageMonthlyExpense) }}/mo expense</p>
          </div>
        </section>

        <section class="mt-6 rounded-xl border border-border bg-card p-4">
          <div class="mb-2 flex items-center justify-between">
            <h2 class="text-sm font-medium">Cashflow trend</h2>
            <p v-if="cashflow" class="text-xs text-muted-foreground">by {{ cashflow.granularity }}</p>
          </div>
          <UiStateBlock
            :empty="!cashflow || cashflow.points.length === 0"
            empty-title="No cashflow data"
            empty-description="Transactions in this range will populate the trend."
            compact
          >
            <ClientOnly>
              <DashboardTrendChart
                v-if="cashflow"
                :labels="cashflowLabels"
                :income="cashflow.points.map((p) => p.income)"
                :expense="cashflow.points.map((p) => p.expense)"
                :net="cashflow.points.map((p) => p.net)"
                :height="'300px'"
              />
            </ClientOnly>
          </UiStateBlock>
        </section>

        <div class="mt-6 grid gap-6 lg:grid-cols-2">
          <section class="rounded-xl border border-border bg-card p-4">
            <div class="mb-3 flex items-center justify-between">
              <h2 class="text-sm font-medium">Spending by category</h2>
              <p v-if="categoryReport" class="text-xs text-muted-foreground tabular-nums">total {{ formatMoney(categoryReport.totalExpense) }}</p>
            </div>
            <UiStateBlock
              :empty="!categoryReport || categoryReport.categories.length === 0"
              empty-title="No expenses in this period"
              empty-description="Category breakdown appears once expenses exist."
              compact
            >
              <ul v-if="categoryReport" class="space-y-3">
                <li v-for="row in categoryReport.categories" :key="row.categoryName">
                  <div class="flex items-center justify-between text-sm">
                    <span class="flex items-center gap-2">
                      <span class="h-2.5 w-2.5 rounded-full" :style="{ backgroundColor: row.categoryColor ?? '#52525b' }" />
                      {{ row.categoryName }}
                    </span>
                    <span class="tabular-nums text-muted-foreground">{{ formatMoney(row.total) }} · {{ percent(row.sharePercent) }}</span>
                  </div>
                  <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div class="h-full rounded-full bg-indigo-400" :style="{ width: `${Math.min(100, row.sharePercent)}%` }" />
                  </div>
                </li>
              </ul>
            </UiStateBlock>
          </section>

          <section class="rounded-xl border border-border bg-card p-4">
            <h2 class="mb-3 text-sm font-medium">Account distribution · total {{ formatMoney(accountReport?.total) }}</h2>
            <UiStateBlock
              :empty="!accountReport || accountReport.accounts.length === 0"
              empty-title="No accounts"
              empty-description="Create an account to see its share."
              compact
            >
              <ClientOnly>
                <DashboardDonutChart v-if="accountReport" :slices="accountSlices" :height="'220px'" />
              </ClientOnly>
              <ul v-if="accountReport" class="mt-2 space-y-1 text-xs text-muted-foreground">
                <li v-for="a in accountReport.accounts" :key="a.id" class="flex justify-between">
                  <span>{{ a.name }}</span>
                  <span class="tabular-nums">{{ formatMoney(a.balance) }}</span>
                </li>
              </ul>
            </UiStateBlock>
          </section>
        </div>

        <section class="mt-6 rounded-xl border border-border bg-card p-4">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-medium">Budget performance</h2>
            <p v-if="budgetReport" class="text-xs text-muted-foreground tabular-nums">
              aggregate adherence {{ budgetReport.aggregate.adherencePercent === null ? '\u2014' : percent(budgetReport.aggregate.adherencePercent) }}
            </p>
          </div>
          <UiStateBlock
            :empty="!budgetReport || budgetReport.budgets.length === 0"
            empty-title="No budgets"
            empty-description="Create budgets to compare planned vs actual spending."
            compact
          >
            <div v-if="budgetReport" class="overflow-x-auto">
              <table class="w-full min-w-[560px] text-sm">
                <thead>
                  <tr class="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th class="px-3 py-2 font-medium">Budget</th>
                    <th class="px-3 py-2 font-medium">Window</th>
                    <th class="px-3 py-2 text-right font-medium">Budgeted</th>
                    <th class="px-3 py-2 text-right font-medium">Spent</th>
                    <th class="px-3 py-2 text-right font-medium">Utilization</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border">
                  <tr v-for="b in budgetReport.budgets" :key="b.id">
                    <td class="px-3 py-2.5 font-medium">{{ b.name }}</td>
                    <td class="px-3 py-2.5 text-muted-foreground">{{ formatDate(b.window.start) }} \u2013 {{ formatDate(b.window.end) }}</td>
                    <td class="px-3 py-2.5 text-right tabular-nums">{{ formatMoney(b.totals.budgeted) }}</td>
                    <td class="px-3 py-2.5 text-right tabular-nums">{{ formatMoney(b.totals.spent) }}</td>
                    <td
                      class="px-3 py-2.5 text-right font-semibold tabular-nums"
                      :class="b.totals.status === 'exceeded' ? 'text-red-400' : b.totals.status === 'warning' ? 'text-amber-400' : 'text-emerald-400'"
                    >
                      {{ percent(b.totals.percent) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </UiStateBlock>
        </section>
      </template>
    </UiStateBlock>
  </div>
</template>
