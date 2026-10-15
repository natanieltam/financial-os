<script setup lang="ts">
import type { AccountDTO } from '../../../server/services/accounts/service'
import type { CategoryDTO } from '../../../server/services/categories/service'
import type { TransactionDTO } from '../../../server/services/transactions/service'
import { apiErrorMessage, toRequestError, useApi } from '../../composables/useApi'
import { transactionCreateSchema, transactionUpdateSchema } from '#shared/schemas/finance'

const props = defineProps<{
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  editing?: TransactionDTO | null
}>()

const emit = defineEmits<{ saved: []; cancelled: [] }>()

const editingType = props.editing?.type
const type = ref<'income' | 'expense' | 'transfer'>(
  editingType === 'income' || editingType === 'expense' || editingType === 'transfer' ? editingType : 'expense',
)
const form = reactive({
  accountId: props.editing?.accountId ?? '',
  toAccountId: '',
  categoryId: props.editing?.categoryId ?? '',
  amount: '',
  transactionDate: new Date().toISOString().slice(0, 10),
  description: props.editing?.description ?? '',
  merchant: props.editing?.merchant ?? '',
  notes: props.editing?.notes ?? '',
})

const pending = ref(false)
const serverError = ref<string | null>(null)
const fieldErrors = reactive<Record<string, string>>({})
// Client-generated idempotency key (PRD §22) — one key per form session, rotated after each success.
const idempotencyKey = ref(crypto.randomUUID())

const flowCategories = computed(() => props.categories.filter((c) => c.type === (type.value === 'income' ? 'income' : 'expense')))
const otherAccounts = computed(() => props.accounts.filter((a) => a.id !== form.accountId && a.status === 'active'))

function validate(): boolean {
  for (const key of Object.keys(fieldErrors)) fieldErrors[key] = ''
  serverError.value = null
  const base = {
    accountId: form.accountId,
    amount: form.amount,
    transactionDate: form.transactionDate,
    description: form.description || undefined,
    merchant: form.merchant || undefined,
    notes: form.notes || undefined,
  }
  const schema = props.editing ? transactionUpdateSchema : transactionCreateSchema
  const parsed = schema.safeParse({
    type: type.value,
    ...base,
    categoryId: type.value === 'transfer' ? undefined : form.categoryId || undefined,
    toAccountId: type.value === 'transfer' ? form.toAccountId : undefined,
  })
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? 'form')] = issue.message
    return false
  }
  return true
}

async function submit(): Promise<void> {
  if (!validate()) return
  pending.value = true
  try {
    const url = props.editing ? `/api/transactions/${props.editing.id}` : '/api/transactions'
    await useApi(url, {
      method: props.editing ? 'PATCH' : 'POST',
      body: {
        type: type.value,
        accountId: form.accountId,
        toAccountId: type.value === 'transfer' ? form.toAccountId : undefined,
        categoryId: type.value === 'transfer' ? undefined : form.categoryId || undefined,
        amount: form.amount,
        transactionDate: form.transactionDate,
        description: form.description || undefined,
        merchant: form.merchant || undefined,
        notes: form.notes || undefined,
      },
      headers: props.editing ? undefined : { 'idempotency-key': idempotencyKey.value },
    })
    if (!props.editing) idempotencyKey.value = crypto.randomUUID()
    emit('saved')
  } catch (error) {
    serverError.value = apiErrorMessage(toRequestError(error))
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <form class="space-y-4 rounded-xl border border-border bg-card p-4" novalidate @submit.prevent="submit">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium">{{ editing ? 'Edit transaction' : 'New transaction' }}</h3>
      <div class="flex gap-1 rounded-lg border border-border p-0.5">
        <button
          v-for="t in ['expense', 'income', 'transfer'] as const"
          :key="t"
          type="button"
          class="rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors"
          :class="type === t ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="type = t"
        >
          {{ t }}
        </button>
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Account</label>
        <select
          v-model="form.accountId"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="" disabled>Select account</option>
          <option v-for="a in accounts.filter((x) => x.status === 'active')" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <p v-if="fieldErrors.accountId" class="mt-1 text-xs text-destructive">{{ fieldErrors.accountId }}</p>
      </div>

      <div v-if="type === 'transfer'">
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">To account</label>
        <select
          v-model="form.toAccountId"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="" disabled>Select destination</option>
          <option v-for="a in otherAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <p v-if="fieldErrors.toAccountId" class="mt-1 text-xs text-destructive">{{ fieldErrors.toAccountId }}</p>
      </div>

      <div v-else>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Category</label>
        <select
          v-model="form.categoryId"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">No category</option>
          <option v-for="c in flowCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <p v-if="fieldErrors.categoryId" class="mt-1 text-xs text-destructive">{{ fieldErrors.categoryId }}</p>
      </div>

      <div>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Amount (IDR)</label>
        <input
          v-model="form.amount"
          inputmode="decimal"
          placeholder="0.00"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums"
        />
        <p v-if="fieldErrors.amount" class="mt-1 text-xs text-destructive">{{ fieldErrors.amount }}</p>
      </div>

      <div>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Date</label>
        <input
          v-model="form.transactionDate"
          type="date"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <p v-if="fieldErrors.transactionDate" class="mt-1 text-xs text-destructive">{{ fieldErrors.transactionDate }}</p>
      </div>

      <div v-if="type !== 'transfer'">
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Merchant</label>
        <input
          v-model="form.merchant"
          placeholder="Optional"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div class="sm:col-span-2">
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Description</label>
        <input
          v-model="form.description"
          placeholder="What was this for?"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <p v-if="fieldErrors.description" class="mt-1 text-xs text-destructive">{{ fieldErrors.description }}</p>
      </div>

      <div class="sm:col-span-2">
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Notes</label>
        <textarea
          v-model="form.notes"
          rows="2"
          placeholder="Optional note"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
    </div>

    <p v-if="serverError" class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
      {{ serverError }}
    </p>

    <div class="flex items-center justify-end gap-2">
      <button
        type="button"
        class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        @click="emit('cancelled')"
      >
        Cancel
      </button>
      <button
        type="submit"
        :disabled="pending"
        class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {{ pending ? 'Saving\u2026' : editing ? 'Save changes' : 'Add transaction' }}
      </button>
    </div>
  </form>
</template>
