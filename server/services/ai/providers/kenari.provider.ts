import {
  AIProviderError,
  type AIChatInput,
  type AIChatResponse,
  type AIProvider,
  type AIProviderConfig,
} from '../ai.types'

/**
 * Kenari integration (PRD §41–§42, Phase 13): OpenAI-compatible chat
 * completions. Server-side only — the API key never reaches the browser.
 *
 * Failure normalization (PRD §41–§42):
 *   - network failure / abort  -> unavailable
 *   - auth failure (401/403)   -> unavailable
 *   - model not found (404)    -> unavailable
 *   - 429                      -> rate_limited
 *   - other non-2xx            -> malformed
 *   - non-JSON or empty answer -> malformed
 * Auth responses are NOT parsed; nothing logged or thrown ever includes the
 * API key, request payload, or provider body (PRD §56).
 */
export class KenariProvider implements AIProvider {
  readonly name = 'kenari'
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(config: AIProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.apiKey = config.apiKey
    this.model = config.model
    this.timeoutMs = config.timeoutMs ?? 30_000
  }

  async chat(input: AIChatInput): Promise<AIChatResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      let response: Response
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: input.messages,
            temperature: input.temperature ?? 0.2,
            max_tokens: input.maxTokens ?? 1024,
          }),
          signal: controller.signal,
        })
      } catch {
        // Network failure or timeout — never surfaced raw (PRD §41).
        throw new AIProviderError('unavailable', 'AI provider is unreachable')
      }

      if (!response.ok) {
        throw this.statusError(response.status)
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new AIProviderError('malformed', 'AI provider returned a non-JSON response')
      }

      const body = payload as {
        model?: unknown
        choices?: Array<{ message?: { content?: unknown } }>
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
      }
      const content = body?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new AIProviderError('malformed', 'AI provider returned an empty response')
      }

      return {
        content,
        provider: this.name,
        model: typeof body.model === 'string' ? body.model : this.model,
        usage:
          typeof body?.usage?.prompt_tokens === 'number' && typeof body?.usage?.completion_tokens === 'number'
            ? { promptTokens: body.usage.prompt_tokens, completionTokens: body.usage.completion_tokens }
            : undefined,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private statusError(status: number): AIProviderError {
    if (status === 401 || status === 403) {
      return new AIProviderError('unavailable', 'AI provider rejected the credentials')
    }
    if (status === 404) {
      return new AIProviderError('unavailable', 'AI provider model was not found')
    }
    if (status === 429) {
      return new AIProviderError('rate_limited', 'AI provider is rate limited. Try again shortly.')
    }
    // PRD §42: non-2xx is treated as malformed unless mapped above.
    return new AIProviderError('malformed', `AI provider responded with status ${status}`)
  }
}
