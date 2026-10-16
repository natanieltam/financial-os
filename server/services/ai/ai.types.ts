/**
 * Provider-independent AI abstraction (PRD §39–§42, Phase 12).
 *
 * Business logic depends ONLY on these types — never on Kenari specifics.
 * The provider is a transport for chat completions; parsing, validation and
 * every financial decision live in the service layer above it.
 */

export interface AIChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AIChatInput {
  messages: AIChatMessage[]
  /** Temperature 0 for structured extraction — deterministic where possible. */
  temperature?: number
  maxTokens?: number
}

export interface AIChatResponse {
  /** Raw assistant text — MUST be validated by Zod before use (never trusted). */
  content: string
  provider: string
  model: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

export type AIProviderErrorKind =
  | 'unavailable' // unreachable / auth / unknown (PRD §41)
  | 'timeout'
  | 'rate_limited'
  | 'malformed' // non-2xx, non-JSON, or empty response (PRD §40, §42)
  | 'error'

/**
 * Normalized provider failure (PRD §40–§42). Messages are authored here and
 * safe by construction: no credentials, stack traces, paths or raw payloads.
 */
export class AIProviderError extends Error {
  readonly kind: AIProviderErrorKind
  constructor(kind: AIProviderErrorKind, message: string) {
    super(message)
    this.name = 'AIProviderError'
    this.kind = kind
  }
}

export interface AIProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs?: number
}

export interface AIProvider {
  readonly name: string
  chat(input: AIChatInput): Promise<AIChatResponse>
}
