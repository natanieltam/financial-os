<script setup lang="ts">
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'

useHead({ title: 'Settings · Financial OS' })

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const saving = ref(false)
const success = ref(false)
const error = ref<string | null>(null)

async function changePassword(): Promise<void> {
  error.value = null
  success.value = false
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Password baru belum cocok.'
    return
  }
  saving.value = true
  try {
    await useApi('/api/auth/password', {
      method: 'POST',
      body: { currentPassword: currentPassword.value, newPassword: newPassword.value },
    })
    success.value = true
    currentPassword.value = newPassword.value = confirmPassword.value = ''
  } catch (err) {
    error.value = apiErrorMessage(toRequestError(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-lg space-y-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
      <p class="mt-1 text-sm text-muted-foreground">
        Keamanan akun lu. Ganti password akan mengeluarkan perangkat lain dari sesi aktif.
      </p>
    </div>

    <form
      class="space-y-4 rounded-xl border border-border bg-card p-5"
      @submit.prevent="changePassword"
    >
      <h2 class="text-sm font-medium">Ganti password</h2>
      <div class="space-y-1.5">
        <label for="current" class="text-xs text-muted-foreground">Password sekarang</label>
        <input
          id="current"
          v-model="currentPassword"
          type="password"
          required
          autocomplete="current-password"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div class="space-y-1.5">
        <label for="new" class="text-xs text-muted-foreground">Password baru (min. 8 karakter)</label>
        <input
          id="new"
          v-model="newPassword"
          type="password"
          required
          minlength="8"
          autocomplete="new-password"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div class="space-y-1.5">
        <label for="confirm" class="text-xs text-muted-foreground">Ulangi password baru</label>
        <input
          id="confirm"
          v-model="confirmPassword"
          type="password"
          required
          minlength="8"
          autocomplete="new-password"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <p v-if="error" class="text-sm text-rose-500">{{ error }}</p>
      <p v-if="success" class="text-sm text-emerald-500">
        Password berhasil diganti. Perangkat lain sudah keluar dari sesi.
      </p>
      <button
        type="submit"
        :disabled="saving"
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {{ saving ? 'Menyimpan...' : 'Ganti password' }}
      </button>
    </form>
  </div>
</template>
