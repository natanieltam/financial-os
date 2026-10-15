<script setup lang="ts">
withDefaults(
  defineProps<{
    loading?: boolean
    error?: string | null
    empty?: boolean
    emptyTitle?: string
    emptyDescription?: string
    compact?: boolean
  }>(),
  {
    loading: false,
    error: null,
    empty: false,
    emptyTitle: 'Nothing here yet',
    emptyDescription: 'Once there is data, it will show up here.',
    compact: false,
  },
)

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div>
    <div
      v-if="loading"
      class="animate-pulse space-y-3"
      :class="compact ? 'py-2' : 'py-10'"
      aria-busy="true"
      aria-label="Loading"
    >
      <div class="h-4 w-1/3 rounded bg-muted" />
      <div class="h-4 w-2/3 rounded bg-muted" />
      <div v-if="!compact" class="h-4 w-1/2 rounded bg-muted" />
    </div>

    <div
      v-else-if="error"
      class="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4"
      role="alert"
    >
      <p class="text-sm font-medium text-destructive">Something went wrong</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ error }}</p>
      <button
        type="button"
        class="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
        @click="emit('retry')"
      >
        Try again
      </button>
    </div>

    <div
      v-else-if="empty"
      class="rounded-lg border border-dashed border-border px-4 text-center"
      :class="compact ? 'py-6' : 'py-12'"
    >
      <p class="text-sm font-medium text-foreground">{{ emptyTitle }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ emptyDescription }}</p>
      <div class="mt-4"><slot name="empty-action" /></div>
    </div>

    <slot v-else />
  </div>
</template>
