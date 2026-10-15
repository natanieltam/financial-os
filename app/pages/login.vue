<script setup lang="ts">
import { z } from 'zod'
import { apiErrorMessage, toRequestError } from '../composables/useApi'

useHead({ title: 'Sign in \u00b7 Financial OS' })
definePageMeta({ layout: false })

const router = useRouter()
const route = useRoute()

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
type LoginInput = z.infer<typeof schema>

const form = reactive<LoginInput>({ email: '', password: '' })
const pending = ref(false)
const serverError = ref<string | null>(null)
const fieldErrors = reactive<Record<string, string>>({})

async function submit(): Promise<void> {
  serverError.value = null
  for (const key of Object.keys(fieldErrors)) fieldErrors[key] = ''
  const parsed = schema.safeParse(form)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? 'form')] = issue.message
    }
    return
  }
  pending.value = true
  try {
    await useApi('/api/auth/login', { method: 'POST', body: parsed.data })
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.replace(redirect)
  } catch (error) {
    serverError.value = apiErrorMessage(toRequestError(error))
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <div class="mb-8 flex items-center gap-3">
        <div
          class="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-sm font-semibold tracking-tight"
        >
          F
        </div>
        <div>
          <h1 class="text-base font-semibold tracking-tight">Financial OS</h1>
          <p class="text-xs text-muted-foreground">Sign in to your workspace</p>
        </div>
      </div>

      <form class="space-y-4" novalidate @submit.prevent="submit">
        <div>
          <label for="email" class="mb-1.5 block text-xs font-medium text-muted-foreground">Email</label>
          <input
            id="email"
            v-model="form.email"
            type="email"
            autocomplete="email"
            required
            class="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-ring"
            placeholder="you@example.com"
          />
          <p v-if="fieldErrors.email" class="mt-1 text-xs text-destructive">{{ fieldErrors.email }}</p>
        </div>
        <div>
          <label for="password" class="mb-1.5 block text-xs font-medium text-muted-foreground">Password</label>
          <input
            id="password"
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            required
            class="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-ring"
            placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
          />
          <p v-if="fieldErrors.password" class="mt-1 text-xs text-destructive">{{ fieldErrors.password }}</p>
        </div>

        <p v-if="serverError" class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {{ serverError }}
        </p>

        <button
          type="submit"
          :disabled="pending"
          class="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {{ pending ? 'Signing in\u2026' : 'Sign in' }}
        </button>
      </form>
    </div>
  </main>
</template>
