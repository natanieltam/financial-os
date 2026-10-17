import { getQuery } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { listFunds } from '../services/mutual_funds/service'

const listQuerySchema = z.object({
  type: z.string().optional(),
  currency: z.string().optional(),
  sharia: z.enum(['true', 'false']).optional(),
  tradable: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
  sort: z.enum(['name', 'nav', 'return1d', 'return1m', 'return1y', 'returnInception']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

export default apiHandler(async (event) => {
  requireUser(event)
  const query = listQuerySchema.parse(getQuery(event))

  return listFunds(query)
})