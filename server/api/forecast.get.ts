import { getQuery } from 'h3'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { forecastQuerySchema } from '../../shared/schemas/finance'
import { computeForecast } from '../services/forecast/service'

/** Deterministic cashflow forecast (Phase 16, PRD §36) — server-side only. */
export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const { days } = forecastQuerySchema.parse(getQuery(event))
  const forecast = await computeForecast(auth.user.id, days)
  return { forecast }
})
