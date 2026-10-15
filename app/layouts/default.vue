<script setup lang="ts">
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'

type Me = { user: { id: string; email: string; name: string | null } }

const router = useRouter()
const user = ref<Me['user'] | null>(null)

const nav = [
  { to: '/', label: 'Dashboard' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/categories', label: 'Categories' },
  { to: '/budgets', label: 'Budgets' },
  { to: '/goals', label: 'Goals' },
  { to: '/health', label: 'Health' },
  { to: '/reports', label: 'Reports' },
]

const initials = computed(() => {
  const name = user.value?.name || user.value?.email || '?'
  return name.slice(0, 1).toUpperCase()
})

onMounted(async () => {
  try {
    const me = await useApi<Me>('/api/me')
    user.value = me.user
  } catch {
    await router.replace('/login')
  }
})

async function logout(): Promise<void> {
  try {
    await useApi('/api/auth/logout', { method: 'POST' })
  } catch (error) {
    console.warn(apiErrorMessage(toRequestError(error)))
  }
  await router.replace('/login')
}
</script>

<template>
  <div class="min-h-screen">
    <header class="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div class="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <NuxtLink to="/" class="flex items-center gap-2.5">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-xs font-semibold tracking-tight"
          >
            F
          </div>
          <span class="text-sm font-semibold tracking-tight">Financial OS</span>
        </NuxtLink>
        <nav class="hidden items-center gap-1 md:flex">
          <NuxtLink
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            class="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            active-class="bg-secondary text-foreground"
          >
            {{ item.label }}
          </NuxtLink>
        </nav>
        <div class="flex items-center gap-2">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold"
            :title="user?.email ?? ''"
          >
            {{ initials }}
          </div>
          <button
            type="button"
            class="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            @click="logout"
          >
            Sign out
          </button>
        </div>
      </div>
      <nav class="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
        <NuxtLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-muted-foreground"
          active-class="bg-secondary text-foreground"
        >
          {{ item.label }}
        </NuxtLink>
      </nav>
    </header>

    <main class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <slot />
    </main>
  </div>
</template>
