<script setup lang="ts">
useHead({ title: 'Financial OS · Private financial intelligence' })
definePageMeta({ layout: false })

const router = useRouter()
const { mode, toggle, init } = useTheme()

const features = [
  { title: 'Track', desc: 'Transactions, accounts, recurring, bills — atomic and precise to the cent.' },
  { title: 'Understand', desc: 'Dashboards, reports and financial health from real data, never estimates.' },
  { title: 'Predict', desc: 'Cashflow forecasting and reminders before money becomes a problem.' },
  { title: 'Plan', desc: 'Budgets and goals that adapt to how you actually spend.' },
  { title: 'Act', desc: 'Optional AI assistant that explains — and never moves money without you.' },
]

onMounted(async () => {
  init()
  // Already signed in? Go straight to the dashboard.
  try {
    await useApi('/api/me')
    await router.replace('/')
  } catch {
    /* not signed in — stay on the landing page */
  }
})
</script>

<template>
  <main class="flex min-h-screen flex-col bg-background text-foreground">
    <!-- top bar -->
    <header class="flex items-center justify-between px-4 py-4 sm:px-8">
      <div class="flex items-center gap-2.5">
        <div
          class="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-sm font-semibold tracking-tight"
        >
          F
        </div>
        <span class="text-sm font-semibold tracking-tight">Financial OS</span>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-sm transition-colors hover:bg-secondary"
          :aria-label="mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          data-testid="theme-toggle"
          @click="toggle"
        >
          {{ mode === 'dark' ? '☀' : '☾' }}
        </button>
        <NuxtLink
          to="/login"
          class="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
        >
          Sign in
        </NuxtLink>
      </div>
    </header>

    <!-- hero -->
    <section class="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-12 text-center sm:px-8">
      <p class="mb-4 text-xs font-medium tracking-widest text-muted-foreground uppercase">
        Self-hosted · Private · Yours
      </p>
      <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">
        Your money, finally legible.
      </h1>
      <p class="mt-4 max-w-xl text-sm text-muted-foreground sm:text-base">
        Financial OS runs entirely on your own machine and database.
        Track, understand, predict, plan and act — without handing your data to anyone.
      </p>
      <p class="mt-3 text-xs font-medium tracking-wide text-muted-foreground">
        TRACK → UNDERSTAND → PREDICT → PLAN → ACT
      </p>

      <div class="mt-8 flex items-center gap-3">
        <NuxtLink
          to="/register"
          class="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Create account
        </NuxtLink>
        <NuxtLink
          to="/login"
          class="rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
        >
          Sign in
        </NuxtLink>
      </div>
    </section>

    <!-- features -->
    <section class="mx-auto grid w-full max-w-4xl gap-3 px-4 pb-16 sm:grid-cols-2 sm:px-8 lg:grid-cols-3">
      <div
        v-for="f in features"
        :key="f.title"
        class="rounded-xl border border-border bg-card p-4 text-left"
      >
        <h2 class="text-sm font-semibold tracking-tight">{{ f.title }}</h2>
        <p class="mt-1 text-xs text-muted-foreground">{{ f.desc }}</p>
      </div>
      <div class="rounded-xl border border-border bg-card p-4 text-left">
        <h2 class="text-sm font-semibold tracking-tight">Yours to run</h2>
        <p class="mt-1 text-xs text-muted-foreground">
          No paid services required. PostgreSQL stays local, AI is optional and never authoritative.
        </p>
      </div>
    </section>

    <footer class="border-t border-border px-4 py-5 text-center text-xs text-muted-foreground sm:px-8">
      Financial OS — runs on your machine, on your database.
    </footer>
  </main>
</template>
