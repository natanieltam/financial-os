import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { budgetReport } from '../../services/reports/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const report = await budgetReport(auth.user.id, new Date())
  return report
})
