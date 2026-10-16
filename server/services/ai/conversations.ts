import { and, desc, eq } from 'drizzle-orm'
import { getDatabase } from '../../../db/client'
import { aiConversations, aiMessages } from '../../../db/schema/index'
import { apiErrors } from '../../utils/api'

/**
 * AI conversation persistence (Phase 15, PRD §38). Every query is scoped to
 * the authenticated user — User A can never see User B's conversations
 * (golden rule 14).
 */

export interface ConversationDTO {
  id: string
  title: string
  model: string | null
  lastMessageAt: string
  createdAt: string
}

export interface MessageDTO {
  id: string
  role: string
  content: string
  createdAt: string
}

function toConversationDTO(row: typeof aiConversations.$inferSelect): ConversationDTO {
  return {
    id: row.id,
    title: row.title ?? '',
    model: row.model,
    lastMessageAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}

function toMessageDTO(row: typeof aiMessages.$inferSelect): MessageDTO {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function createConversation(userId: string, title: string, model: string | null): Promise<ConversationDTO> {
  const [row] = await getDatabase()
    .insert(aiConversations)
    .values({ userId, title: title.slice(0, 80), model })
    .returning()
  return toConversationDTO(row!)
}

/** Ownership-protected read: a foreign conversation is a 404, never a 403 leak. */
export async function getOwnedConversation(userId: string, id: string): Promise<ConversationDTO> {
  const rows = await getDatabase()
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, userId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw apiErrors.notFound('Conversation not found')
  return toConversationDTO(row)
}

export async function listConversations(userId: string, limit = 50): Promise<ConversationDTO[]> {
  const rows = await getDatabase()
    .select()
    .from(aiConversations)
    .where(eq(aiConversations.userId, userId))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(limit)
  return rows.map(toConversationDTO)
}

export async function listMessages(userId: string, conversationId: string): Promise<MessageDTO[]> {
  await getOwnedConversation(userId, conversationId)
  const rows = await getDatabase()
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(aiMessages.createdAt)
  return rows.map(toMessageDTO)
}

export async function appendMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  structured?: unknown,
): Promise<void> {
  await getDatabase().insert(aiMessages).values({
    conversationId,
    role,
    content,
    structuredResult: structured ?? undefined,
  })
  await getDatabase()
    .update(aiConversations)
    .set({ updatedAt: new Date() })
    .where(eq(aiConversations.id, conversationId))
}

/** Keeps prompt history bounded for long conversations (last N messages). */
export function recentHistory(messages: MessageDTO[], max = 12): MessageDTO[] {
  return messages.slice(-max)
}
