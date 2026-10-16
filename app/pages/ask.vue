<script setup lang="ts">
import { apiErrorMessage, toRequestError, useApi } from '../composables/useApi'
import { formatDate } from '../lib/format'

useHead({ title: 'Ask Your Finances · Financial OS' })

type Message = { id: string; role: 'user' | 'assistant' | 'system'; content: string; createdAt: string }
type Conversation = { id: string; title: string; lastMessageAt: string }
type AskResult = { conversationId: string; answer: string; deterministic: boolean }

const conversations = ref<Conversation[]>([])
const activeId = ref<string | null>(null)
const messages = ref<Message[]>([])
const question = ref('')
const asking = ref(false)
const loadingHistory = ref(false)
const listError = ref<string | null>(null)
const chatError = ref<string | null>(null)

async function loadConversations(): Promise<void> {
  listError.value = null
  try {
    const result = await useApi<{ items: Conversation[] }>('/api/ai/conversations')
    conversations.value = result.items
  } catch (err) {
    listError.value = apiErrorMessage(toRequestError(err))
  }
}

async function openConversation(id: string): Promise<void> {
  activeId.value = id
  chatError.value = null
  loadingHistory.value = true
  try {
    const result = await useApi<{ conversation: Conversation; messages: Message[] }>(`/api/ai/conversations/${id}`)
    messages.value = result.messages
  } catch (err) {
    chatError.value = apiErrorMessage(toRequestError(err))
  } finally {
    loadingHistory.value = false
  }
}

async function ask(): Promise<void> {
  const text = question.value.trim()
  if (!text || asking.value) return
  asking.value = true
  chatError.value = null
  messages.value = [...messages.value, { id: `local-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() }]
  question.value = ''
  try {
    const result = await useApi<AskResult>('/api/ai/ask', {
      method: 'POST',
      body: { question: text, conversationId: activeId.value ?? undefined },
    })
    activeId.value = result.conversationId
    messages.value = [...messages.value, { id: `ai-${Date.now()}`, role: 'assistant', content: result.answer, createdAt: new Date().toISOString() }]
    await loadConversations()
  } catch (err) {
    chatError.value = apiErrorMessage(toRequestError(err))
  } finally {
    asking.value = false
  }
}

function newConversation(): void {
  activeId.value = null
  messages.value = []
  chatError.value = null
}

const suggestions = [
  'Bagaimana pengeluaran bulan ini?',
  'Kategori mana yang paling besar?',
  'Apakah saya aman untuk 30 hari ke depan?',
  'Progres goal saya gimana?',
]

onMounted(loadConversations)
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1 class="text-xl font-semibold tracking-tight">Ask your finances</h1>
      <p class="text-sm text-muted-foreground">
        The server calculates every number first; the AI only explains your own financial context. It cannot see other data or change anything.
      </p>
    </header>

    <div class="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside class="space-y-3">
        <button
          type="button"
          class="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          @click="newConversation"
        >
          New conversation
        </button>
        <UiStateBlock :error="listError" :empty="!conversations.length && !listError" empty-title="No conversations yet" empty-description="Ask your first question." compact @retry="loadConversations">
          <ul class="space-y-1">
            <li v-for="c in conversations" :key="c.id">
              <button
                type="button"
                class="w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm transition-colors"
                :class="activeId === c.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'"
                :title="c.title"
                @click="openConversation(c.id)"
              >
                {{ c.title || 'Untitled' }}
                <span class="block text-[10px] text-muted-foreground">{{ formatDate(c.lastMessageAt) }}</span>
              </button>
            </li>
          </ul>
        </UiStateBlock>
      </aside>

      <section class="flex min-h-[420px] flex-col rounded-xl border border-border bg-card">
        <div class="flex-1 space-y-4 overflow-y-auto p-4">
          <UiStateBlock :loading="loadingHistory" compact />
          <UiStateBlock v-if="chatError" :error="chatError" compact @retry="ask" />

          <div v-if="!messages.length && !loadingHistory && !chatError" class="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p class="text-sm text-muted-foreground">Ask anything about your own finances.</p>
            <div class="flex flex-wrap justify-center gap-2">
              <button
                v-for="s in suggestions"
                :key="s"
                type="button"
                class="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                @click="question = s; ask()"
              >
                {{ s }}
              </button>
            </div>
          </div>

          <div v-for="m in messages" :key="m.id" class="flex" :class="m.role === 'user' ? 'justify-end' : 'justify-start'">
            <div
              class="max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm leading-relaxed"
              :class="m.role === 'user' ? 'bg-primary text-primary-foreground' : 'border border-border bg-background text-foreground'"
            >
              {{ m.content }}
            </div>
          </div>

          <div v-if="asking" class="flex justify-start">
            <div class="flex items-center gap-2 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-muted-foreground" aria-busy="true">
              <span class="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              Analyzing your context…
            </div>
          </div>
        </div>

        <form class="flex gap-2 border-t border-border p-3" @submit.prevent="ask">
          <input
            v-model="question"
            type="text"
            placeholder="e.g. Berapa pengeluaran makanan bulan ini?"
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            aria-label="Ask a question"
          >
          <button
            type="submit"
            :disabled="asking || !question.trim()"
            class="shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Ask
          </button>
        </form>
      </section>
    </div>
  </div>
</template>
