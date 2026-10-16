<script setup lang="ts">
import type { AccountDTO } from '../../server/services/accounts/service'
import { accountCreateSchema } from '#shared/schemas/finance'
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'
import { formatMoney } from '../lib/format'
import { ACCOUNT_TYPES } from '#shared/constants/finance'

useHead({ title: 'Accounts · Financial OS' })

const accounts = ref<AccountDTO[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)
const showForm = ref(false)
const pending = ref(false)
const deletingId = ref<string | null>(null)
const restoringId = ref<string | null>(null)

const form = reactive({ name: '', type: 'bank', initialBalance: '0' })
const fieldErrors = reactive<Record<string, string>>({})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await useApi<{ accounts: AccountDTO[] }>('/api/accounts', { query: { includeArchived: true } })
    accounts.value = result.accounts
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function create(): Promise<void> {
  for (const key of Object.keys(fieldErrors)) fieldErrors[key] = ''
  actionError.value = null
  const parsed = accountCreateSchema.safeParse(form)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? 'form')] = issue.message
    return
  }
  pending.value = true
  try {
    await useApi('/api/accounts', { method: 'POST', body: parsed.data })
    showForm.value = false
    form.name = ''
    form.initialBalance = '0'
    await load()
  } catch (err) {
    actionError.value = apiErrorMessage(toRequestError(err))
  } finally {
    pending.value = false
  }
}

async function archive(account: AccountDTO): Promise<void> {
  deletingId.value = account.id
  actionError.value = null
  try {
    await useApi(`/api/accounts/${account.id}`, { method: 'DELETE' })
    await load()
  } catch (err) {
    actionError.value = apiErrorMessage(toRequestError(err))
  } finally {
    deletingId.value = null
  }
}

async function restore(account: AccountDTO): Promise<void> {
  restoringId.value = account.id
  actionError.value = null
  try {
    await useApi(`/api/accounts/${account.id}`, { method: 'PATCH', body: { status: 'active' } })
    await load()
  } catch (err) {
    actionError.value = apiErrorMessage(toRequestError(err))
  } finally {
    restoringId.value = null
  }
}

function labelize(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Accounts</h1>
        <p class="text-sm text-muted-foreground">Balances are always derived from your transactions</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        @click="showForm = !showForm"
      >
        {{ showForm ? 'Close' : 'Add account' }}
      </button>
    </header>

    <form v-if="showForm" class="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" novalidate @submit.prevent="create">
      <div>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
        <input v-model="form.name" placeholder="e.g. BCA" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        <p v-if="fieldErrors.name" class="mt-1 text-xs text-destructive">{{ fieldErrors.name }}</p>
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Type</label>
        <select v-model="form.type" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option v-for="t in ACCOUNT_TYPES" :key="t" :value="t">{{ labelize(t) }}</option>
        </select>
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Opening balance</label>
        <input v-model="form.initialBalance" inputmode="decimal" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums" />
        <p v-if="fieldErrors.initialBalance" class="mt-1 text-xs text-destructive">{{ fieldErrors.initialBalance }}</p>
      </div>
      <div class="flex items-end">
        <button type="submit" :disabled="pending" class="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {{ pending ? 'Saving\u2026' : 'Create' }}
        </button>
      </div>
      <p v-if="actionError" class="text-sm text-destructive sm:col-span-4" role="alert">{{ actionError }}</p>
    </form>

    <UiStateBlock :loading="loading" :error="error" :empty="accounts.length === 0" empty-title="No accounts yet" empty-description="Create a bank account, e-wallet or cash account to begin." @retry="load">
      <template #empty-action>
        <button type="button" class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" @click="showForm = true">
          Add account
        </button>
      </template>

      <p v-if="actionError" class="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
        {{ actionError }}
      </p>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="account in accounts"
          :key="account.id"
          class="rounded-xl border bg-card p-4 transition-colors"
          :class="account.status === 'archived' ? 'opacity-60' : 'border-border'"
        >
          <div class="flex items-start justify-between">
            <div>
              <p class="text-sm font-semibold">{{ account.name }}</p>
              <p class="text-[11px] uppercase tracking-wide text-muted-foreground">{{ labelize(account.type) }}</p>
            </div>
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              :class="account.status === 'active' ? 'border-emerald-500/30 text-emerald-400' : 'border-border text-muted-foreground'"
            >
              {{ account.status }}
            </span>
          </div>
          <p class="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{{ formatMoney(account.balance) }}</p>
          <div class="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{{ account.transactionCount }} transactions</span>
            <button
              v-if="account.status === 'active'"
              type="button"
              class="text-muted-foreground hover:text-destructive disabled:opacity-50"
              :disabled="deletingId === account.id"
              @click="archive(account)"
            >
              {{ deletingId === account.id ? 'Archiving\u2026' : 'Archive' }}
            </button>
            <button
              v-else
              type="button"
              class="text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
              :disabled="restoringId === account.id"
              @click="restore(account)"
            >
              {{ restoringId === account.id ? 'Restoring\u2026' : 'Restore' }}
            </button>
          </div>
        </article>
      </div>
    </UiStateBlock>
  </div>
</template>
