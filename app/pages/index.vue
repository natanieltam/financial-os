<script setup lang="ts">
import type { DashboardPayload } from '../../server/services/dashboard/service'
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'
import { formatDateTime, formatMoney, percent } from '../lib/format'

useHead({ title: 'Dashboard · Financial OS' })

const data = ref<DashboardPayload | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await useApi<DashboardPayload>('/api/dashboard')
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

const cashflowLabels = computed(() =>
  (data.value?.cashflow ?? []).map((d) => d.period.slice(5)),
)
const hasCashflow = computed(() => (data.value?.cashflow.length ?? 0) > 0)
const categorySlices = computed(() =>
  (data.value?.topCategories ?? []).map((c) => ({
    name: c.categoryName,
    value: Math.round(Number(c.total)),
  })),
)
const healthTone = computed(() => {
  const score = data.value?.health.score
  if (score === null || score === undefined) return 'text-muted-foreground'
  if (score >= 70) return 'text-emerald-400'
  if (score >= 45) return 'text-amber-400'
  return 'text-red-400'
})
</script>

<template>
  <div class="space-y-8">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p class="text-sm text-muted-foreground">Your financial position at a glance</p>
      </div>
      <NuxtLink to="/transactions" class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary">
        Add transaction
      </NuxtLink>
    </header>

    <UiStateBlock :loading="loading" :error="error" @retry="load">
      <template v-if="data">
        <!-- Overview strip -->
        <section class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div class="rounded-xl border border-border bg-card p-4">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total balance</p>
            <p class="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{{ formatMoney(data.totals.balance) }}</p>
          </div>
          <div class="rounded-xl border border-border bg-card p-4">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">This month income</p>
            <p class="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-emerald-400">{{ formatMoney(data.month.income) }}</p>
          </div>
          <div class="rounded-xl border border-border bg-card p-4">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">This month expense</p>
            <p class="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-red-400">{{ formatMoney(data.month.expense) }}</p>
          </div>
          <div class="rounded-xl border border-border bg-card p-4">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Net cashflow (month)</p>
            <p
              class="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums"
              :class="data.month.net.startsWith('-') ? 'text-red-400' : 'text-foreground'"
            >
              {{ formatMoney(data.month.net) }}
            </p>
          </div>
        </section>

        <!-- Cashflow chart -->
        <section class="mt-6 rounded-xl border border-border bg-card p-4">
          <div class="mb-2 flex items-center justify-between">
            <h2 class="text-sm font-medium">Cashflow · last 90 days</h2>
            <p class="text-xs text-muted-foreground">Income vs expense, daily</p>
          </div>
          <UiStateBlock
            :empty="!hasCashflow"
            empty-title="No cashflow yet"
            empty-description="Add income or expense transactions to see your trend."
            compact
          >
            <ClientOnly>
              <DashboardTrendChart
                :labels="cashflowLabels"
                :income="data.cashflow.map((d) => d.income)"
                :expense="data.cashflow.map((d) => d.expense)"
                :net="data.cashflow.map((d) => d.net)"
              />
            </ClientOnly>
          </UiStateBlock>
        </section>

        <div class="mt-6 grid gap-6 lg:grid-cols-3">
          <!-- Accounts -->
          <section class="lg:col-span-1">
            <div class="mb-3 flex items-center justify-between">
              <h2 class="text-sm font-medium">Accounts</h2>
              <NuxtLink to="/accounts" class="text-xs text-muted-foreground hover:text-foreground">Manage</NuxtLink>
            </div>
            <UiStateBlock
              :empty="data.accounts.length === 0"
              empty-title="No accounts"
              empty-description="Create an account to start tracking."
              compact
            >
              <template #empty-action>
                <NuxtLink to="/accounts" class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Add account</NuxtLink>
              </template>
              <ul class="divide-y divide-border rounded-xl border border-border bg-card">
                <li v-for="account in data.accounts" :key="account.id" class="flex items-center justify-between px-4 py-3">
                  <div>
                    <p class="text-sm font-medium">{{ account.name }}</p>
                    <p class="text-[11px] uppercase tracking-wide text-muted-foreground">{{ account.type.replaceAll('_', ' ') }}</p>
                  </div>
                  <p class="text-sm font-semibold tabular-nums">{{ formatMoney(account.balance) }}</p>
                </li>
              </ul>
            </UiStateBlock>
          </section>

          <!-- Recent transactions -->
          <section class="lg:col-span-1">
            <div class="mb-3 flex items-center justify-between">
              <h2 class="text-sm font-medium">Recent transactions</h2>
              <NuxtLink to="/transactions" class="text-xs text-muted-foreground hover:text-foreground">View all</NuxtLink>
            </div>
            <UiStateBlock
              :empty="data.recentTransactions.length === 0"
              empty-title="No transactions"
              empty-description="Your latest activity will appear here."
              compact
            >
              <ul class="divide-y divide-border rounded-xl border border-border bg-card">
                <li
                  v-for="tx in data.recentTransactions"
                  :key="tx.id"
                  class="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">{{ tx.description || tx.merchant || tx.type }}</p>
                    <p class="text-[11px] text-muted-foreground">
                      {{ formatDateTime(tx.transactionDate) }}<template v-if="tx.accountName"> · {{ tx.accountName }}</template><template v-if="tx.categoryName"> · {{ tx.categoryName }}</template>
                    </p>
                  </div>
                  <p
                    class="shrink-0 text-sm font-semibold tabular-nums"
                    :class="tx.type === 'income' ? 'text-emerald-400' : tx.type === 'expense' ? 'text-red-400' : 'text-muted-foreground'"
                  >
                    {{ tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : '' }}{{ formatMoney(tx.amount) }}
                  </p>
                </li>
              </ul>
            </UiStateBlock>
          </section>

          <!-- Budgets + health + categories -->
          <section class="space-y-6">
            <div>
              <div class="mb-3 flex items-center justify-between">
                <h2 class="text-sm font-medium">Budgets</h2>
                <NuxtLink to="/budgets" class="text-xs text-muted-foreground hover:text-foreground">Manage</NuxtLink>
              </div>
              <UiStateBlock
                :empty="data.budgets.length === 0"
                empty-title="No budgets"
                empty-description="Set monthly limits per category."
                compact
              >
                <ul class="space-y-3 rounded-xl border border-border bg-card p-4">
                  <li v-for="budget in data.budgets" :key="budget.id">
                    <div class="flex items-center justify-between text-sm">
                      <span class="font-medium">{{ budget.name }}</span>
                      <span class="tabular-nums text-muted-foreground">{{ percent(budget.percent) }}</span>
                    </div>
                    <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        class="h-full rounded-full transition-all"
                        :class="budget.status === 'exceeded' ? 'bg-red-400' : budget.status === 'warning' ? 'bg-amber-400' : 'bg-emerald-400'"
                        :style="{ width: `${Math.min(100, Math.max(0, budget.percent))}%` }"
                      />
                    </div>
                    <p class="mt-1 text-[11px] text-muted-foreground tabular-nums">{{ formatMoney(budget.spent) }} of {{ formatMoney(budget.budgeted) }}</p>
                  </li>
                </ul>
              </UiStateBlock>
            </div>

            <div>
              <div class="mb-3 flex items-center justify-between">
                <h2 class="text-sm font-medium">Financial health</h2>
                <NuxtLink to="/health" class="text-xs text-muted-foreground hover:text-foreground">Details</NuxtLink>
              </div>
              <div class="rounded-xl border border-border bg-card p-4">
                <p class="text-3xl font-semibold tracking-tight tabular-nums" :class="healthTone">
                  {{ data.health.score === null ? '\u2014' : data.health.score }}
                  <span class="text-sm font-normal text-muted-foreground">/ 100</span>
                </p>
                <p class="mt-1 text-sm capitalize text-muted-foreground">{{ data.health.status.replaceAll('-', ' ') }}</p>
              </div>
            </div>

            <div>
              <h2 class="mb-3 text-sm font-medium">Spending by category · this month</h2>
              <UiStateBlock
                :empty="categorySlices.length === 0"
                empty-title="No spending this month"
                empty-description="Category breakdown appears once you log expenses."
                compact
              >
                <div class="rounded-xl border border-border bg-card p-2">
                  <ClientOnly>
                    <DashboardDonutChart :slices="categorySlices" />
                  </ClientOnly>
                </div>
              </UiStateBlock>
            </div>
          </section>
        </div>
      </template>
    </UiStateBlock>
  </div>
</template>
