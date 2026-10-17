<script setup lang="ts">
import {
  ArrowLeftRight,
  ChartLine,
  ChartPie,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PiggyBank,
  ReceiptText,
  Repeat,
  Settings,
  Sparkles,
  Sun,
  Tags,
  Target,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'

type Me = { user: { id: string; email: string; name: string | null } }

type NavItem = { to: string; label: string; icon: Component }

const router = useRouter()
const route = useRoute()
const user = ref<Me['user'] | null>(null)

/**
 * Primary navigation. Rendered exactly once in the DOM: a static sidebar from
 * lg up, and the very same element sliding in as the burger drawer below lg —
 * one copy keeps landmarks and controls unambiguous for assistive tech and the
 * browser E2E suite alike.
 */
const nav: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/budgets', label: 'Budgets', icon: PiggyBank },
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/bills', label: 'Bills', icon: ReceiptText },
  { to: '/forecast', label: 'Forecast', icon: ChartLine },
  { to: '/ask', label: 'Ask AI', icon: Sparkles },
  { to: '/investments', label: 'Investasi', icon: TrendingUp },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/health', label: 'Health', icon: HeartPulse },
  { to: '/reports', label: 'Reports', icon: ChartPie },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const navOpen = ref(false)

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(`${to}/`)
}

const initials = computed(() => {
  const name = user.value?.name || user.value?.email || '?'
  return name.slice(0, 1).toUpperCase()
})

const { mode: themeMode, toggle: toggleTheme, init: initTheme } = useTheme()

// A nav tap should reveal the page it navigated to.
watch(
  () => route.fullPath,
  () => {
    navOpen.value = false
  },
)

// Keep the page behind the open drawer from scrolling.
watch(navOpen, (open) => {
  if (import.meta.client) document.body.style.overflow = open ? 'hidden' : ''
})

onMounted(async () => {
  initTheme()
  try {
    const me = await useApi<Me>('/api/me')
    user.value = me.user
  } catch {
    await router.replace('/welcome')
  }
})

onBeforeUnmount(() => {
  if (import.meta.client) document.body.style.overflow = ''
})

async function logout(): Promise<void> {
  try {
    await useApi('/api/auth/logout', { method: 'POST' })
  } catch (error) {
    console.warn(apiErrorMessage(toRequestError(error)))
  }
  await router.replace('/welcome')
}
</script>

<template>
  <div class="min-h-screen lg:flex">
    <!-- Mobile top bar: the burger opens the drawer -->
    <header
      class="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:hidden"
    >
      <button
        type="button"
        data-testid="nav-toggle"
        class="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        aria-label="Open navigation"
        aria-controls="app-sidebar"
        :aria-expanded="navOpen"
        @click="navOpen = true"
      >
        <Menu class="h-5 w-5" />
      </button>
      <NuxtLink to="/" class="flex items-center gap-2.5">
        <span
          class="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-xs font-semibold tracking-tight"
        >
          F
        </span>
        <span class="text-sm font-semibold tracking-tight">Financial OS</span>
      </NuxtLink>
    </header>

    <!-- Backdrop: mobile only, tap to dismiss -->
    <div
      v-if="navOpen"
      class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
      aria-hidden="true"
      @click="navOpen = false"
    />

    <!-- One nav instance: off-canvas drawer below lg, static sidebar from lg up -->
    <aside
      id="app-sidebar"
      class="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:max-w-none lg:translate-x-0 lg:bg-background lg:transition-none"
      :class="navOpen ? 'translate-x-0 shadow-2xl lg:shadow-none' : '-translate-x-full'"
    >
      <div class="flex items-center justify-between gap-2 px-3 py-4">
        <NuxtLink to="/" class="flex items-center gap-2.5 rounded-md px-2 py-1">
          <span
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-xs font-semibold tracking-tight"
          >
            F
          </span>
          <span class="text-sm font-semibold tracking-tight">Financial OS</span>
        </NuxtLink>
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
          aria-label="Close navigation"
          @click="navOpen = false"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <nav class="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Primary">
        <NuxtLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          :class="isActive(item.to) ? 'bg-secondary font-medium text-foreground' : ''"
          :aria-current="isActive(item.to) ? 'page' : undefined"
        >
          <component :is="item.icon" class="h-4 w-4 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ item.label }}</span>
        </NuxtLink>
      </nav>

      <div class="space-y-0.5 border-t border-border p-3">
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          :aria-label="themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          data-testid="theme-toggle"
          @click="toggleTheme"
        >
          <Sun v-if="themeMode === 'dark'" class="h-4 w-4 shrink-0" aria-hidden="true" />
          <Moon v-else class="h-4 w-4 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ themeMode === 'dark' ? 'Light mode' : 'Dark mode' }}</span>
        </button>
        <div class="flex items-center gap-3 px-3 py-2">
          <span
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold"
            :title="user?.email ?? ''"
          >
            {{ initials }}
          </span>
          <span class="truncate text-xs text-muted-foreground">{{ user?.email ?? '' }}</span>
        </div>
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          @click="logout"
        >
          <LogOut class="h-4 w-4 shrink-0" aria-hidden="true" />
          <span class="truncate">Sign out</span>
        </button>
      </div>
    </aside>

    <main class="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div class="mx-auto w-full max-w-6xl">
        <slot />
      </div>
    </main>
  </div>
</template>
