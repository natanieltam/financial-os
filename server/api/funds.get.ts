import { getQuery } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import {
  listFunds,
  getFundById,
  getFundNavHistory,
  getFundsWithLatestNav,
  getMoneyMarketFunds,
  syncMutualFunds,
} from '../services/mutual_funds/service'

const listQuerySchema = z.object({
  type: z.string().optional(),
  currency: z.string().optional(),
  sharia: z.enum(['true', 'false']).optional(),
  tradable: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

const navQuerySchema = z.object({
  fundId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
})

export default apiHandler(async (event) => {
  requireUser(event)
  const query = listQuerySchema.parse(getQuery(event))

  const result = await listFunds(query)
  return result
})