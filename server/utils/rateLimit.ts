import { getRequestIP, type H3Event } from 'h3'
import { apiErrors } from './api'

interface Bucket {
  count: number
  resetAt: number
}

/** In-memory sliding-window limiter (single-process; PRD §61). */
const buckets = new Map<string, Bucket>()

export function clientIp(event: H3Event): string {
  try {
    return getRequestIP(event, { xForwardedFor: false }) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function rateLimitKey(bucket: string, event: H3Event): string {
  return `${bucket}|${clientIp(event)}`
}

export function rateLimit(event: H3Event, bucket: string, limit: number, windowMs: number): void {
  enforce(bucket, clientIp(event), limit, windowMs)
}

/**
 * Per-user limiter for authenticated endpoints (PRD §61). Keys on the stable
 * session user id, not the client IP, so a shared NAT/office IP (or parallel
 * test workers) never starves unrelated users. Runs after requireUser.
 */
export function rateLimitUser(event: H3Event, userId: string, bucket: string, limit: number, windowMs: number): void {
  enforce(bucket, `user:${userId}`, limit, windowMs)
}

function enforce(bucket: string, subject: string, limit: number, windowMs: number): void {
  const key = `${bucket}|${subject}`
  const now = Date.now()
  const entry = buckets.get(key)
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
    }
    return
  }
  entry.count += 1
  if (entry.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    throw apiErrors.rateLimited(`Too many requests. Please try again in ${retryAfter} seconds.`)
  }
}

export function resetRateLimit(event: H3Event, bucket: string): void {
  buckets.delete(rateLimitKey(bucket, event))
}
