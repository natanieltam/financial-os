<script setup lang="ts">
import { z } from 'zod'
import { apiErrorMessage, toRequestError } from '../composables/useApi'

useHead({ title: 'Create account · Financial OS' })
definePageMeta({ layout: false })

const router = useRouter()

const schema = z
  .object({
    name: z.string().trim().max(100),
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  })
type RegisterInput = z.infer<typeof schema>

const form = reactive<Omit<RegisterInput, 'confirm'> & { confirm: string }>({
  name: '',
  email: '',
  password: '',
  confirm: '',
})
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
    // Register creates the user and opens a session server-side, then we land
    // on the dashboard. No financial data is fabricated on sign-up.
    await useApi('/api/auth/register', {
      method: 'POST',
      body: { name: parsed.data.name, email: parsed.data.email, password: parsed.data.password },
    })
    await router.replace('/')
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
          <p class="text-xs text-muted-foreground">Create your private workspace</p>
        </div>
      </div>

      <form class="space-y-4" novalidate @submit.prevent="submit">
        <div>
          <label for="name" class="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
          <input
            id="name"
            v-model="form.name"
            type="text"
            autocomplete="name"
            required
            class="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-ring"
            placeholder="Your name"
          />
          <p v-if="fieldErrors.name" class="mt-1 text-xs text-destructive">{{ fieldErrors.name }}</p>
        </div>
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
            autocomplete="new-password"
            required
            class="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-ring"
            placeholder="••••••••"
          />
          <p v-if="fieldErrors.password" class="mt-1 text-xs text-destructive">{{ fieldErrors.password }}</p>
        </div>
        <div>
          <label for="confirm" class="mb-1.5 block text-xs font-medium text-muted-foreground">Confirm password</label>
          <input
            id="confirm"
            v-model="form.confirm"
            type="password"
            autocomplete="new-password"
            required
            class="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-ring"
            placeholder="••••••••"
          />
          <p v-if="fieldErrors.confirm" class="mt-1 text-xs text-destructive">{{ fieldErrors.confirm }}</p>
        </div>

        <p
          v-if="serverError"
          class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {{ serverError }}
        </p>

        <button
          type="submit"
          :disabled="pending"
          class="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {{ pending ? 'Creating account…' : 'Create account' }}
        </button>
      </form>

      <p class="mt-6 text-center text-xs text-muted-foreground">
        Already have an account?
        <NuxtLink to="/login" class="font-medium text-foreground underline underline-offset-2">Sign in</NuxtLink>
      </p>
    </div>
  </main>
</template>
