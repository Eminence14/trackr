import { getStore } from '@netlify/blobs'
import { handleParse } from '../../server/parse'
import { blobStore } from '../../server/infra'

// One shared cache for every instance of this function, so a link that goes viral is read once, not once per person.
export default async (req: Request) => handleParse(req, { store: blobStore(getStore('trackr-cache')), budgetMs: Number(process.env.PARSE_BUDGET_MS) || 9000 })

export const config = {
  path: '/api/parse',
  // The platform turns away floods before this code even starts. The same limit exists in code as a backstop.
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
