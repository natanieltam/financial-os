import { getQuery } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { listBills } from '../services/bills/service'
import { BILL_STATUSES } from '../../shared/constants/finance'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const query = z
    .object({ status: z.enum(BILL_STATUSES).optional() })
    .parse(getQuery(event))
  return { items: await listBills(auth.user.id, { status: query.status }) }
})
