import { useRuntimeConfig } from 'nitropack/runtime'
import { apiErrors } from '../../utils/api'
import {
  AIProviderError,
  type AIChatResponse,
  type AIProvider,
} from './ai.types'
import { askAnswerSchema, extractJsonObject, transactionIntentSchema } from './ai.schemas'
import { KenariProvider } from './providers/kenari.provider'

/**
 * AI service layer (Phase 12–15). The application talks to this — never to a
 * provider directly. All financial numbers stay deterministic and
 * server-computed; AI only parses text and explains supplied facts (PRD §39).
 */

const DEFAULT_TIMEOUT_MS = 30_000

/** Returns the configured provider, or null when Kenari is not configured. */
export function getAiProvider(): AIProvider | null {
  const cfg = useRuntimeConfig().kenari as { baseUrl: string; apiKey: string; model: string }
  if (!cfg?.apiKey || !cfg?.model) return null
  return new KenariProvider({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  })
}

/** Throws the safe 503 AI_UNAVAILABLE error when no provider is configured/usable. */
export function requireAiProvider(): AIProvider {
  const provider = getAiProvider()
  if (!provider) throw apiErrors.aiUnavailable()
  return provider
}

/**
 * Normalizes provider failures to safe ApiErrors (PRD §41, §54). Malformed,
 * unavailable and timeout failures all degrade to AI_UNAVAILABLE so the rest
 * of the application keeps working; the message is always authored by us.
 */
export function providerErrorToApiError(err: unknown) {
  if (err instanceof AIProviderError) {
    if (err.kind === 'rate_limited') return apiErrors.rateLimited(err.message)
    return apiErrors.aiUnavailable(
      err.kind === 'malformed'
        ? 'AI returned an unexpected response. Please try again.'
        : err.message,
    )
  }
  return err
}

/** Runs a chat completion with normalized error handling. */
export async function runChat(
  provider: AIProvider,
  input: Parameters<AIProvider['chat']>[0],
): Promise<AIChatResponse> {
  try {
    return await provider.chat(input)
  } catch (err) {
    throw providerErrorToApiError(err)
  }
}

/** Parses AI text into a validated transaction intent — untrusted until Zod passes. */
export function parseIntentFromResponse(content: string) {
  const json = extractJsonObject(content)
  const result = transactionIntentSchema.safeParse(json)
  if (!result.success) {
    throw providerErrorToApiError(
      new AIProviderError('malformed', 'AI returned an unexpected response. Please try again.'),
    )
  }
  return result.data
}

/** Parses AI text into a validated Ask answer — plain text answers are accepted. */
export function parseAskAnswer(content: string) {
  const json = extractJsonObject(content)
  const structured = askAnswerSchema.safeParse(json)
  if (structured.success) return structured.data
  const text = typeof content === 'string' ? content.trim() : ''
  const fallback = askAnswerSchema.safeParse({ answer: text })
  if (!fallback.success) {
    throw providerErrorToApiError(
      new AIProviderError('malformed', 'AI returned an unexpected response. Please try again.'),
    )
  }
  return fallback.data
}
