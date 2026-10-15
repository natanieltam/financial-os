import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { getDashboard } from '../services/dashboard/service'

/** Aggregated dashboard payload (PRD §26–§28) — all numbers server-computed. */
export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const payload = await getDashboard(auth.user.id)
  return payload
})
