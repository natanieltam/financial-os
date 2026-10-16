<script setup lang="ts">
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'
import { formatDate, formatMoney } from '../lib/format'

useHead({ title: 'Forecast · Financial OS' })

type ForecastPayload = {
  days: number
  asOf: string
  startingBalance: string
  recurring: { incomeTotal: string; expenseTotal: string; templateCount: number }
  bills: { total: string; count: number }
  baselineDailyExpense: string | null
  projection: {
    recurringIncomeTotal: string
    recurringExpenseTotal: string
    billsTotal: string
    baselineTotal: string | null
    projectedEndBalance: string
    willBeNegative: boolean
    series: Array<{ date: string; balance: string }>
    assumptions: string[]
  }
}

const HORIZONS = [30, 60, 90]
const horizon = ref(30)
const forecast = ref<ForecastPayload | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await useApi<{ forecast: ForecastPayload }>('/api/forecast', {
      query: { days: horizon.value },
    })
    forecast.value = result.forecast
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    loading.value = false
  }
}

watch(horizon, () => void load())
onMounted(load)

const series = computed(() => forecast.value?.projection.series ?? [])

const lowestBalance = computed(() => {
  if (!series.value.length) return '0.00'
  return series.value.reduce((min, p) => (Number(p.balance) < Number(min) ? p.balance : min), series.value[0]!.balance)
})

const tiles = computed(() => {
  const f = forecast.value
  if (!f) return []
  return [
    { label: 'Starting balance', value: f.startingBalance, tone: '' },
    { label: `Recurring income · ${f.recurring.templateCount}`, value: f.recurring.incomeTotal, tone: 'text-emerald-500' },
    { label: `Recurring expenses · ${f.recurring.templateCount}`, value: f.recurring.expenseTotal, tone: 'text-rose-500' },
    { label: `Upcoming bills · ${f.bills.count}`, value: f.bills.total, tone: 'text-rose-500' },
    { label: 'Baseline daily spend', value: f.baselineDailyExpense ?? null, tone: '' },
    { label: `Projected end · ${f.days}d`, value: f.projection.projectedEndBalance, tone: f.projection.willBeNegative ? 'text-rose-500' : 'text-emerald-500' },
  ]
})

/** Deterministic SVG line: projected balance across the horizon. */
const chart = computed(() => {
  const data = series.value
  if (data.length < 2) return null
  const width = 720
  const height = 180
  const pad = 8
  const values = data.map((p) => Number(p.balance))
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const span = max - min || 1
  const points = data.map((p, i) => ({
    x: pad + (i / (data.length - 1)) * (width - pad * 2),
    y: height - pad - ((Number(p.balance) - min) / span) * (height - pad * 2),
    date: p.date,
    balance: p.balance,
  }))
  const zeroY = height - pad - ((0 - min) / span) * (height - pad * 2)
  return { width, height, points, zeroY }
})

function sparkPath(): string {
  if (!chart.value) return ''
  return chart.value.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

const sampleRows = computed(() => {
  const data = series.value
  if (!data.length) return []
  const step = Math.max(1, Math.floor(data.length / 10))
  return data.filter((_, i) => i % step === 0 || i === data.length - 1)
})
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Cashflow forecast</h1>
        <p class="text-sm text-muted-foreground">
          Deterministic projection from live balances, recurring templates and upcoming bills — computed server-side, never by AI. The AI may only explain these numbers.
        </p>
      </div>
      <div class="flex rounded-md border border-border bg-card p-0.5" role="tablist" aria-label="Forecast horizon">
        <button
          v-for="h in HORIZONS"
          :key="h"
          type="button"
          role="tab"
          :aria-selected="horizon === h"
          class="rounded px-3 py-1 text-xs font-medium transition-colors"
          :class="horizon === h ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="horizon = h"
        >
          {{ h }}d
        </button>
      </div>
    </header>

    <UiStateBlock
      :loading="loading"
      :error="error"
      :empty="!!(forecast && !forecast.projection.series.length)"
      empty-title="No projection yet"
      empty-description="Add accounts and transactions to see your 30/60/90-day projection."
      @retry="load"
    >
      <div v-if="forecast" class="space-y-5">
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div v-for="tile in tiles" :key="tile.label" class="rounded-xl border border-border bg-card p-3">
            <p class="text-xs text-muted-foreground">{{ tile.label }}</p>
            <p class="mt-1 text-sm font-semibold tabular-nums" :class="tile.tone">
              {{ tile.value === null ? '—' : formatMoney(tile.value) }}
            </p>
          </div>
        </div>

        <div v-if="forecast.projection.willBeNegative" class="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-500">
          Projected balance goes negative within {{ forecast.days }} days — consider reducing discretionary spend or moving money between accounts.
        </div>

        <figure v-if="chart" class="rounded-xl border border-border bg-card p-4">
          <svg :viewBox="`0 0 ${chart.width} ${chart.height}`" class="h-44 w-full" role="img" aria-label="Projected balance trend">
            <defs>
              <linearGradient id="forecast-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="hsl(var(--primary))" stop-opacity="0.25" />
                <stop offset="100%" stop-color="hsl(var(--primary))" stop-opacity="0" />
              </linearGradient>
            </defs>
            <line :x1="0" :x2="chart.width" :y1="chart.zeroY" :y2="chart.zeroY" stroke="hsl(var(--border))" stroke-dasharray="4 4" />
            <path :d="`${sparkPath()} L${chart.points[chart.points.length - 1]?.x},${chart.height} L${chart.points[0]?.x},${chart.height} Z`" fill="url(#forecast-fill)" />
            <path :d="sparkPath()" fill="none" stroke="hsl(var(--primary))" stroke-width="2" stroke-linejoin="round" />
          </svg>
          <figcaption class="mt-2 text-xs text-muted-foreground">
            {{ formatMoney(forecast.startingBalance) }} today → {{ formatMoney(forecast.projection.projectedEndBalance) }} in {{ forecast.days }} days · lowest projected {{ formatMoney(lowestBalance) }}
          </figcaption>
        </figure>

        <div class="grid gap-5 lg:grid-cols-2">
          <div class="overflow-x-auto rounded-xl border border-border bg-card">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th class="px-4 py-2 font-medium">Date</th>
                  <th class="px-4 py-2 text-right font-medium">Projected balance</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in sampleRows" :key="row.date" class="border-b border-border/50 last:border-0">
                  <td class="px-4 py-1.5 text-muted-foreground">{{ formatDate(row.date) }}</td>
                  <td class="px-4 py-1.5 text-right tabular-nums" :class="Number(row.balance) < 0 ? 'text-rose-500' : ''">{{ formatMoney(row.balance) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="rounded-xl border border-border bg-card p-4">
            <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assumptions</h2>
            <ul class="mt-2 space-y-1.5">
              <li v-for="a in forecast.projection.assumptions" :key="a" class="text-xs text-muted-foreground">• {{ a }}</li>
            </ul>
          </div>
        </div>
      </div>
    </UiStateBlock>
  </div>
</template>
