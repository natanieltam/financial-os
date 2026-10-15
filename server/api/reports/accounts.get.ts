import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { accountReport } from '../../services/reports/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const report = await accountReport(auth.user.id)
  return report
})
