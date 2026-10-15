<script setup lang="ts">
import type { CategoryDTO } from '../../server/services/categories/service'
import { categoryCreateSchema } from '#shared/schemas/finance'
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'

useHead({ title: 'Categories \u00b7 Financial OS' })

const categories = ref<CategoryDTO[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)
const pendingId = ref<string | null>(null)

const form = reactive({ name: '', type: 'expense', color: '' })
const creating = ref(false)
const fieldErrors = reactive<Record<string, string>>({})
const renaming = reactive<{ id: string | null; name: string }>({ id: null, name: '' })

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await useApi<{ categories: CategoryDTO[] }>('/api/categories')
    categories.value = result.categories
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

const incomeCats = computed(() => categories.value.filter((c) => c.type === 'income'))
const expenseCats = computed(() => categories.value.filter((c) => c.type === 'expense'))

async function create(): Promise<void> {
  for (const key of Object.keys(fieldErrors)) fieldErrors[key] = ''
  actionError.value = null
  const parsed = categoryCreateSchema.safeParse({
    name: form.name,
    type: form.type,
    color: form.color || undefined,
  })
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? 'form')] = issue.message
    return
  }
  creating.value = true
  try {
    await useApi('/api/categories', { method: 'POST', body: parsed.data })
    form.name = ''
    form.color = ''
    await load()
  } catch (err) {
    actionError.value = apiErrorMessage(toRequestError(err))
  } finally {
    creating.value = false
  }
}

async function saveRename(category: CategoryDTO): Promise<void> {
  actionError.value = null
  try {
    await useApi(`/api/categories/${category.id}`, { method: 'PATCH', body: { name: renaming.name } })
    renaming.id = null
    await load()
  } catch (err) {
    actionError.value = apiErrorMessage(toRequestError(err))
  }
}

async function archive(category: CategoryDTO): Promise<void> {
  pendingId.value = category.id
  actionError.value = null
  try {
    await useApi(`/api/categories/${category.id}`, { method: 'DELETE' })
    await load()
  } catch (err) {
    actionError.value = apiErrorMessage(toRequestError(err))
  } finally {
    pendingId.value = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Categories</h1>
        <p class="text-sm text-muted-foreground">System defaults plus your own \u00b7 referenced categories are archived, never corrupted</p>
      </div>
    </header>

    <form class="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" novalidate @submit.prevent="create">
      <div>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">New category</label>
        <input v-model="form.name" placeholder="e.g. Pets" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        <p v-if="fieldErrors.name" class="mt-1 text-xs text-destructive">{{ fieldErrors.name }}</p>
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Flow</label>
        <select v-model="form.type" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-medium text-muted-foreground">Color (hex)</label>
        <input v-model="form.color" placeholder="#818cf8" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
      </div>
      <div class="flex items-end">
        <button type="submit" :disabled="creating" class="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {{ creating ? 'Adding\u2026' : 'Add' }}
        </button>
      </div>
    </form>

    <p v-if="actionError" class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
      {{ actionError }}
    </p>

    <UiStateBlock :loading="loading" :error="error" :empty="categories.length === 0" empty-title="No categories" empty-description="Default categories load automatically; add your own above." @retry="load">
      <div class="grid gap-6 lg:grid-cols-2">
        <section v-for="group in [{ title: 'Expense', items: expenseCats }, { title: 'Income', items: incomeCats }]" :key="group.title">
          <h2 class="mb-3 text-sm font-medium">{{ group.title }} categories</h2>
          <ul class="divide-y divide-border rounded-xl border border-border bg-card">
            <li v-for="category in group.items" :key="category.id" class="flex items-center justify-between gap-3 px-4 py-2.5">
              <div class="flex min-w-0 items-center gap-2.5">
                <span
                  class="h-2.5 w-2.5 shrink-0 rounded-full"
                  :style="{ backgroundColor: category.color ?? '#52525b' }"
                />
                <template v-if="renaming.id === category.id">
                  <input
                    v-model="renaming.name"
                    class="w-40 rounded-md border border-border bg-background px-2 py-1 text-sm"
                    @keyup.enter="saveRename(category)"
                  />
                </template>
                <template v-else>
                  <span class="truncate text-sm" :class="category.isArchived ? 'text-muted-foreground line-through' : ''">
                    {{ category.name }}
                  </span>
                  <span v-if="category.isSystem" class="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">system</span>
                  <span v-if="category.isArchived" class="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">archived</span>
                </template>
              </div>
              <div class="flex shrink-0 items-center gap-3 text-xs">
                <span class="text-muted-foreground tabular-nums">{{ category.transactionCount }} tx</span>
                <template v-if="!category.isSystem && !category.isArchived">
                  <button
                    v-if="renaming.id !== category.id"
                    type="button"
                    class="text-muted-foreground hover:text-foreground"
                    @click="renaming.id = category.id; renaming.name = category.name"
                  >
                    Rename
                  </button>
                  <button v-else type="button" class="text-foreground" @click="saveRename(category)">Save</button>
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    :disabled="pendingId === category.id"
                    @click="archive(category)"
                  >
                    {{ pendingId === category.id ? 'Working\u2026' : 'Remove' }}
                  </button>
                </template>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </UiStateBlock>
  </div>
</template>
