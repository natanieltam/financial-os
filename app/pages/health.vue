<script setup lang="ts">
import type { HealthResult } from '../../server/services/analytics/health'
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'

useHead({ title: 'Financial health \u00b7 Financial OS' })

const health = ref<HealthResult | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    health.value = await useApi<HealthResult>('/api/health')
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

const scoreTone = computed(() => {
  const score = health.value?.score
  if (score === null || score === undefined) return 'text-muted-foreground'
  if (score >= 70) return 'text-emerald-400'
  if (score >= 45) return 'text-amber-400'
  return 'text-red-400'
})

function componentTone(score: number | null): string {
  if (score === null) return 'text-muted-foreground'
  if (score >= 70) return 'text-emerald-400'
  if (score >= 45) return 'text-amber-400'
  return 'text-red-400'
}
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1 class="text-xl font-semibold tracking-tight">Financial health</h1>
      <p class="text-sm text-muted-foreground">
        Deterministic score from your real data \u2014 fixed weights, never AI-generated
      </p>
    </header>

    <UiStateBlock :loading="loading" :error="error" @retry="load">
      <template v-if="health">
        <section class="rounded-xl border border-border bg-card p-6">
          <div class="flex flex-wrap items-end gap-6">
            <div>
              <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Overall score</p>
              <p class="mt-1 text-5xl font-semibold tracking-tight tabular-nums" :class="scoreTone">
                {{ health.score === null ? '\u2014' : health.score }}
                <span class="text-lg font-normal text-muted-foreground">/ 100</span>
              </p>
            </div>
            <div class="pb-1">
              <p class="text-sm font-medium capitalize">{{ health.status.replaceAll('-', ' ') }}</p>
              <p class="mt-1 max-w-md text-sm text-muted-foreground">
                Weighted from deterministic metrics over your transaction history.
              </p>
            </div>
          </div>

          <p v-if="health.unavailableComponents.length" class="mt-4 rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
            Not enough data yet for: {{ health.unavailableComponents.join(', ') }} \u2014 these components are excluded until sufficient history exists.
          </p>
        </section>

        <section class="mt-6">
          <h2 class="mb-3 text-sm font-medium">Components</h2>
          <ul class="divide-y divide-border rounded-xl border border-border bg-card">
            <li v-for="component in health.components" :key="component.key" class="px-4 py-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="text-sm font-medium">{{ component.label }}</p>
                  <p class="text-xs text-muted-foreground">
                    Weight {{ component.weight }}% \u00b7 {{ component.raw ?? 'insufficient data' }}
                  </p>
                </div>
                <p class="text-lg font-semibold tabular-nums" :class="componentTone(component.score)">
                  {{ component.score === null ? 'n/a' : component.score }}
                  <span class="text-xs font-normal text-muted-foreground">/ 100</span>
                </p>
              </div>
              <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  class="h-full rounded-full transition-all"
                  :class="component.score === null ? 'bg-border' : component.score >= 70 ? 'bg-emerald-400' : component.score >= 45 ? 'bg-amber-400' : 'bg-red-400'"
                  :style="{ width: `${Math.min(100, Math.max(0, component.score ?? 0))}%` }"
                />
              </div>
              <p class="mt-1.5 text-[11px] text-muted-foreground">{{ component.interpretation }}</p>
            </li>
          </ul>
        </section>
      </template>
    </UiStateBlock>
  </div>
</template>
