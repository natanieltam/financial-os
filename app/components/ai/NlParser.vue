<script setup lang="ts">
import type { AccountDTO } from '../../../server/services/accounts/service'
import type { CategoryDTO } from '../../../server/services/categories/service'
import { apiErrorMessage, toRequestError, useApi } from '../../composables/useApi'
import { formatMoney } from '../../lib/format'

/**
 * Natural-language transaction entry (Phase 14). AI never mutates: this
 * component renders the server-built preview (editable) and only records
 * after explicit user confirmation, through the standard
 * POST /api/transactions (TransactionService) path.
 */

type ParsePreview = {
  transaction: {
    type: 'income' | 'expense'
    accountId: string
    categoryId: string | null
    amount: string
    description: string | null
    transactionDate: string
  }
  notes: string[]
  resolution: Array<{ field: string; strategy: string }>
}

type ParseResult = {
  preview: ParsePreview | null
  clarification: { message: string; missingFields: string[]; suggestions: string[] } | null
}

const props = defineProps<{ accounts: AccountDTO[]; categories: CategoryDTO[] }>()
const emit = defineEmits<{ saved: [] }>()

const note = ref('')
const parsing = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const clarification = ref<ParseResult['clarification']>(null)
const preview = ref<ParsePreview | null>(null)
const resolution = ref<Array<{ field: string; strategy: string }>>([])
const edited = ref(false)

const previewCategories = computed(() =>
  props.categories.filter((c) => (preview.value ? c.type === preview.value.transaction.type : true)),
)

async function parse(): Promise<void> {
  if (!note.value.trim()) return
  parsing.value = true
  error.value = null
  clarification.value = null
  preview.value = null
  edited.value = false
  try {
    const result = await useApi<ParseResult>('/api/ai/transaction-parser', {
      method: 'POST',
      body: { text: note.value.trim() },
    })
    if (result.preview) {
      preview.value = result.preview
      resolution.value = result.preview.resolution
    } else {
      clarification.value = result.clarification
    }
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    parsing.value = false
  }
}

function onEdit(): void {
  edited.value = true
}

async function confirm(): Promise<void> {
  if (!preview.value) return
  saving.value = true
  error.value = null
  try {
    await useApi('/api/transactions', { method: 'POST', body: preview.value.transaction })
    note.value = ''
    preview.value = null
    clarification.value = null
    emit('saved')
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    saving.value = false
  }
}

function cancel(): void {
  preview.value = null
  clarification.value = null
  edited.value = false
}
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-4" aria-label="Add with AI">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold tracking-tight">Add with AI</h2>
        <p class="text-xs text-muted-foreground">
          Type naturally, e.g. “tadi makan ayam geprek 25 ribu”. Nothing is saved until you confirm the preview.
        </p>
      </div>
      <span class="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">AI preview</span>
    </div>

    <form class="mt-3 flex flex-col gap-2 sm:flex-row" @submit.prevent="parse">
      <input
        v-model="note"
        type="text"
        placeholder="tadi makan ayam geprek 25 ribu"
        class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        aria-label="Natural language transaction"
      >
      <button
        type="submit"
        :disabled="parsing || !note.trim()"
        class="shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <span v-if="parsing" class="inline-flex items-center gap-1.5">
          <span class="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
          Parsing…
        </span>
        <span v-else>Parse</span>
      </button>
    </form>

    <UiStateBlock :loading="parsing" compact class="mt-3" />

    <!-- Clarification: never guess missing financial data -->
    <div v-if="clarification" class="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3" role="status">
      <p class="text-sm font-medium text-amber-500">Need clarification</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ clarification.message }}</p>
      <ul v-if="clarification.suggestions.length" class="mt-2 space-y-1">
        <li v-for="s in clarification.suggestions" :key="s" class="text-xs text-muted-foreground">— {{ s }}</li>
      </ul>
      <button type="button" class="mt-3 text-xs font-medium text-foreground underline underline-offset-2" @click="cancel">
        Dismiss
      </button>
    </div>

    <!-- Preview: exactly what will be recorded -->
    <div v-if="preview" class="mt-3 space-y-3 rounded-lg border border-border bg-background/50 p-4" role="region" aria-label="Transaction preview">
      <div class="flex items-center justify-between">
        <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview — nothing recorded yet</p>
        <span v-if="edited" class="text-[10px] font-medium text-amber-500">Edited by you</span>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="space-y-1">
          <span class="text-xs text-muted-foreground">Type</span>
          <select
            v-model="preview.transaction.type"
            class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            @change="onEdit"
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label class="space-y-1">
          <span class="text-xs text-muted-foreground">Amount (IDR)</span>
          <input
            v-model="preview.transaction.amount"
            type="text"
            inputmode="decimal"
            class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            @input="onEdit"
          >
        </label>
        <label class="space-y-1">
          <span class="text-xs text-muted-foreground">Account</span>
          <select
            v-model="preview.transaction.accountId"
            class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            @change="onEdit"
          >
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </label>
        <label class="space-y-1">
          <span class="text-xs text-muted-foreground">Category</span>
          <select
            v-model="preview.transaction.categoryId"
            class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            @change="onEdit"
          >
            <option :value="null">— none —</option>
            <option v-for="c in previewCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <label class="space-y-1">
          <span class="text-xs text-muted-foreground">Date</span>
          <input
            v-model="preview.transaction.transactionDate"
            type="date"
            class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            @change="onEdit"
          >
        </label>
        <label class="space-y-1">
          <span class="text-xs text-muted-foreground">Description</span>
          <input
            v-model="preview.transaction.description"
            type="text"
            class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            @input="onEdit"
          >
        </label>
      </div>

      <ul v-if="preview.notes.length" class="space-y-1">
        <li v-for="n in preview.notes" :key="n" class="text-xs text-muted-foreground">• {{ n }}</li>
      </ul>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          :disabled="saving"
          class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          @click="confirm"
        >
          {{ saving ? 'Saving…' : 'Confirm & record' }}
        </button>
        <button
          type="button"
          class="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          @click="cancel"
        >
          Cancel
        </button>
        <span class="text-xs text-muted-foreground">
          Records {{ preview.transaction.type }} {{ formatMoney(preview.transaction.amount) }}
        </span>
      </div>
    </div>

    <UiStateBlock v-if="error" :error="error" compact class="mt-3" @retry="parse" />
  </section>
</template>
