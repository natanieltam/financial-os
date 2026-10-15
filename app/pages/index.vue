<script setup lang="ts">
useHead({ title: 'Financial OS' })
</script>

<template>
  <main class="space-y-6">
    <header class="flex items-center gap-3">
      <div
        class="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-sm font-semibold tracking-tight"
      >
        F
      </div>
      <div>
        <h1 class="text-lg font-semibold tracking-tight">Financial OS</h1>
        <p class="text-sm text-muted-foreground">Personal financial intelligence</p>
      </div>
    </header>

    <section class="rounded-xl border border-border bg-card/50 p-6">
      <p class="text-sm text-zinc-300">
        Fondasi proyek sedang dibangun (Phase 1). Fitur keuangan, autentikasi, database, dan AI
        belum diimplementasikan.
      </p>
      <p class="mt-2 text-xs text-muted-foreground">
        Status: project foundation — Nuxt 4 + TypeScript + Tailwind + shadcn-vue/Reka UI.
      </p>
    </section>
  </main>
</template>
