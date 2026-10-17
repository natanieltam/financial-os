import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { syncMutualFunds } from '../../services/mutual_funds/service'

export default apiHandler(async (event) => {
  requireUser(event)
  const stats = await syncMutualFunds()
  return stats
})