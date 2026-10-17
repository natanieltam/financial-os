<script setup lang="ts">
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'
import { formatDate, formatMoney } from '../lib/format'

useHead({ title: 'Investasi · Financial OS' })

type FundReturns = {
  day1: number | null
  week1: number | null
  month1: number | null
  month3: number | null
  month6: number | null
  ytd: number | null
  year1: number | null
  year3: number | null
  year5: number | null
  inception: number | null
}

type Fund = {
  id: string
  code: string
  bibitId: string | null
  name: string
  manager: string | null
  type: string
  currency: string
  sharia: boolean
  launchDate: string | null
  isTradable: boolean
  latestNav: number | null
  latestNavDate: string | null
  navRows: number
  returns: FundReturns
}

type NavPoint = { date: string; nav: number | null; navAdjusted: number | null }

const funds = ref<Fund[]>([])
const total = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)
const syncing = ref(false)
const syncResult = ref<string | null>(null)

const filters = reactive({ type: '', search: '', sort: 'name' as const })
const selected = ref<Fund | null>(null)
const navSeries = ref<NavPoint[]>([])
const navLoading = ref(false)

const TYPE_OPTIONS = ['', 'Pasar Uang', 'Obligasi', 'Saham', 'Campuran', 'Terproteksi', 'Reksadana Global', 'Dana Investasi Real Estate', 'Penyertaan Terbatas', 'ETF', 'DPLK', 'Lainnya']

const moneyMarket = computed(() => funds.value.filter((f) => f.type === 'Pasar Uang'))

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await useApi<{ funds: Fund[]; total: number; limit: number; offset: number }>('/api/funds', {
      query: {
        type: filters.type || undefined,
        search: filters.search || undefined,
        sort: filters.sort,
        limit: 200,
      },
    })
    funds.value = result.funds
    total.value = result.total
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearchInput(): void {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 300)
}

async function sync(): Promise<void> {
  syncing.value = true
  syncResult.value = null
  try {
    const stats = await useApi<{
      fundsUpserted: number
      navFundsSynced: number
      navRowsWritten: number
      durationMs: number
      errors: string[]
    }>('/api/funds/sync', { method: 'POST' })
    const errCount = stats.errors.length
    syncResult.value = `Synced ${stats.fundsUpserted} funds · ${stats.navFundsSynced} funds with NAV · ${stats.navRowsWritten} NAV rows (${(stats.durationMs / 1000).toFixed(1)}s)${errCount ? ` · ${errCount} errors` : ''}`
    await load()
  } catch (err) {
    syncResult.value = apiErrorMessage(toRequestError(err))
  } finally {
    syncing.value = false
  }
}

async function openDetail(fund: Fund): Promise<void> {
  selected.value = fund
  navSeries.value = []
  navLoading.value = true
  try {
    const result = await useApi<{ navSeries: NavPoint[] }>(`/api/funds/${fund.id}/nav`, {
      query: { days: 365 },
    })
    navSeries.value = result.navSeries
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    navLoading.value = false
  }
}

function closeDetail(): void {
  selected.value = null
}

function typeTone(type: string): string {
  switch (type) {
    case 'Pasar Uang':
      return 'border-sky-500/30 text-sky-400'
    case 'Obligasi':
      return 'border-violet-500/30 text-violet-400'
    case 'Saham':
      return 'border-rose-500/30 text-rose-400'
    case 'Campuran':
      return 'border-amber-500/30 text-amber-400'
    case 'Terproteksi':
      return 'border-teal-500/30 text-teal-400'
    case 'Reksadana Global':
      return 'border-indigo-500/30 text-indigo-400'
    case 'Dana Investasi Real Estate':
      return 'border-orange-500/30 text-orange-400'
    case 'ETF':
      return 'border-lime-500/30 text-lime-400'
    default:
      return 'border-border text-muted-foreground'
  }
}

function retTone(value: number | null): string {
  if (value === null || value === 0 || !Number.isFinite(value)) return 'text-muted-foreground'
  return value > 0 ? 'text-emerald-400' : 'text-rose-400'
}

function retText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`
}

/** Minimal inline SVG sparkline — no chart dependency. */
const sparkline = computed(() => {
  const pts = navSeries.value.filter((p) => p.navAdjusted !== null)
  if (pts.length < 2) return null
  const vals = pts.map((p) => p.navAdjusted!)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const w = 100
  const h = 28
  const step = w / (vals.length - 1)
  const coords = vals.map((v, i) => [i * step, h - ((v - min) / range) * h] as const)
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `${path} L${w},${h} L0,${h} Z`
  const first = vals[0]!
  const last = vals[vals.length - 1]!
  return { path, area, min, max, changePct: ((last - first) / first) * 100 }
})
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold">Investasi</h1>
        <p class="text-sm text-muted-foreground">
          Harga NAV harian reksadana Indonesia. Sumber data gratis via Bibit / OJK.
        </p>
      </div>
      <button
        type="button"
        class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        :disabled="syncing"
        @click="sync"
      >
        {{ syncing ? 'Syncing…' : 'Sync NAV' }}
      </button>
    </div>

    <p v-if="syncResult" class="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground" role="status">
      {{ syncResult }}
    </p>

    <!-- Summary tiles -->
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-xl border border-border bg-card p-4">
        <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total Funds</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums">{{ total }}</p>
      </div>
      <div class="rounded-xl border border-border bg-card p-4">
        <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pasar Uang</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums">{{ moneyMarket.length }}</p>
      </div>
      <div class="rounded-xl border border-border bg-card p-4">
        <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Syariah</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums">{{ funds.filter((f) => f.sharia).length }}</p>
      </div>
      <div class="rounded-xl border border-border bg-card p-4">
        <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Loaded</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums">{{ funds.length }}</p>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex flex-wrap gap-1">
        <button
          v-for="t in TYPE_OPTIONS"
          :key="t || 'all'"
          type="button"
          class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
          :class="filters.type === t ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground'"
          @click="filters.type = t; load()"
        >
          {{ t || 'Semua' }}
        </button>
      </div>
      <select
        v-model="filters.sort"
        class="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        @change="load"
      >
        <option value="name">Nama</option>
        <option value="nav">NAV Terakhir</option>
        <option value="return1d">1 Hari</option>
        <option value="return1m">1 Bulan</option>
        <option value="return1y">1 Tahun</option>
        <option value="returnInception">Sejak Awal</option>
      </select>
      <input
        v-model="filters.search"
        type="search"
        placeholder="Cari nama / manajer / kode…"
        class="ml-auto w-56 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        @input="onSearchInput"
      />
    </div>

    <!-- Fund list -->
    <UiStateBlock
      :loading="loading"
      :error="error"
      :empty="funds.length === 0"
      empty-title="Belum ada data"
      empty-description="Klik “Sync NAV” untuk mengambil daftar reksadana dan riwayat harga dari sumber data gratis."
      @retry="load"
    >
      <template #empty-action>
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          :disabled="syncing"
          @click="sync"
        >
          {{ syncing ? 'Syncing…' : 'Sync NAV' }}
        </button>
      </template>

      <div class="overflow-hidden rounded-xl border border-border bg-card">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th class="px-4 py-2.5 font-medium">Nama</th>
              <th class="px-4 py-2.5 font-medium">Jenis</th>
              <th class="px-4 py-2.5 text-right font-medium">NAV</th>
              <th class="hidden px-4 py-2.5 text-right font-medium md:table-cell">1 Bln</th>
              <th class="hidden px-4 py-2.5 text-right font-medium md:table-cell">1 Thn</th>
              <th class="hidden px-4 py-2.5 text-right font-medium lg:table-cell">YTD</th>
              <th class="px-4 py-2.5 text-right font-medium">Tanggal</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="fund in funds"
              :key="fund.id"
              class="cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-secondary/50"
              tabindex="0"
              @click="openDetail(fund)"
              @keydown.enter="openDetail(fund)"
            >
              <td class="px-4 py-2.5">
                <p class="font-medium">{{ fund.name }}</p>
                <p class="text-xs text-muted-foreground">{{ fund.manager || '—' }}</p>
              </td>
              <td class="px-4 py-2.5">
                <span class="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide" :class="typeTone(fund.type)">
                  {{ fund.type }}
                </span>
                <span v-if="fund.sharia" class="ml-1 rounded-full border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-400">S</span>
              </td>
              <td class="px-4 py-2.5 text-right tabular-nums">{{ formatMoney(fund.latestNav) }}</td>
              <td class="hidden px-4 py-2.5 text-right tabular-nums md:table-cell" :class="retTone(fund.returns.month1)">{{ retText(fund.returns.month1) }}</td>
              <td class="hidden px-4 py-2.5 text-right tabular-nums md:table-cell" :class="retTone(fund.returns.year1)">{{ retText(fund.returns.year1) }}</td>
              <td class="hidden px-4 py-2.5 text-right tabular-nums lg:table-cell" :class="retTone(fund.returns.ytd)">{{ retText(fund.returns.ytd) }}</td>
              <td class="px-4 py-2.5 text-right text-xs text-muted-foreground">{{ formatDate(fund.latestNavDate) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiStateBlock>

    <!-- Detail drawer -->
    <div v-if="selected" class="fixed inset-0 z-50 flex justify-end" @keydown.esc="closeDetail">
      <button type="button" class="absolute inset-0 bg-background/70" aria-label="Close" @click="closeDetail" />
      <aside class="relative h-full w-full max-w-md overflow-y-auto border-l border-border bg-card p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold">{{ selected.name }}</h2>
            <p class="text-xs text-muted-foreground">{{ selected.manager || '—' }}</p>
          </div>
          <button type="button" class="text-sm text-muted-foreground hover:text-foreground" @click="closeDetail">Tutup</button>
        </div>

        <div class="mt-4 rounded-xl border border-border bg-background/40 p-4">
          <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">NAV Terbaru</p>
          <p class="mt-1 text-3xl font-semibold tabular-nums">{{ formatMoney(selected.latestNav) }}</p>
          <p class="text-xs text-muted-foreground">{{ formatDate(selected.latestNavDate) }}</p>

          <div v-if="sparkline" class="mt-3">
            <svg viewBox="0 0 100 28" preserveAspectRatio="none" class="h-16 w-full" aria-hidden="true">
              <defs>
                <linearGradient :id="`grad-${selected.id}`" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="currentColor" stop-opacity="0.25" />
                  <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path :d="sparkline.area" :fill="`url(#grad-${selected.id})`" />
              <path :d="sparkline.path" fill="none" stroke="currentColor" stroke-width="1.2" vector-effect="non-scaling-stroke" />
            </svg>
            <div class="mt-1 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
              <span>Low {{ formatMoney(String(sparkline.min)) }}</span>
              <span :class="retTone(sparkline.changePct)">{{ retText(sparkline.changePct) }}</span>
              <span>High {{ formatMoney(String(sparkline.max)) }}</span>
            </div>
          </div>
          <p v-else class="mt-3 text-xs text-muted-foreground">Riwayat NAV belum tersedia.</p>
        </div>

        <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div
            v-for="item in [
              { label: '1 Hari', value: selected.returns.day1 },
              { label: '1 Minggu', value: selected.returns.week1 },
              { label: '1 Bulan', value: selected.returns.month1 },
              { label: '3 Bulan', value: selected.returns.month3 },
              { label: '6 Bulan', value: selected.returns.month6 },
              { label: 'YTD', value: selected.returns.ytd },
              { label: '1 Tahun', value: selected.returns.year1 },
              { label: '3 Tahun', value: selected.returns.year3 },
              { label: '5 Tahun', value: selected.returns.year5 },
              { label: 'Sejak Awal', value: selected.returns.inception },
            ]"
            :key="item.label"
          >
            <dt class="text-[11px] uppercase tracking-wide text-muted-foreground">{{ item.label }}</dt>
            <dd class="tabular-nums" :class="retTone(item.value)">{{ retText(item.value) }}</dd>
          </div>
        </dl>

        <div class="mt-4 space-y-2 rounded-xl border border-border bg-background/40 p-4 text-xs" style="max-height: 200px; overflow-y: auto;">
          <p v-if="navLoading" class="text-muted-foreground">Memuat riwayat…</p>
          <template v-else-if="navSeries.length">
            <div class="flex justify-between font-medium uppercase tracking-wide">
              <span class="text-muted-foreground">Tanggal</span>
              <span class="text-muted-foreground">NAV (Adj)</span>
            </div>
            <div v-for="point in [...navSeries].reverse()" :key="point.date" class="flex justify-between tabular-nums">
              <span class="text-muted-foreground">{{ formatDate(point.date) }}</span>
              <span>{{ formatMoney(point.navAdjusted) }}</span>
            </div>
          </template>
          <p v-else class="text-muted-foreground">Tidak ada riwayat untuk dana ini.</p>
        </div>

        <p class="mt-4 text-[11px] text-muted-foreground">
          Sumber: Bibit/OJK · NAV harian, diperbarui tiap hari kerja · bukan harga real-time tick-by-tick.
        </p>
      </aside>
    </div>
  </div>
</template>