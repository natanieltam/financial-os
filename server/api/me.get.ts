import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'

/** Current authenticated user — identity comes from the server-side session. */
export default apiHandler(async (event) => {
  const { user } = requireUser(event)
  return { user }
})
