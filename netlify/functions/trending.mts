import { getStore } from '@netlify/blobs'
import { handleTrending } from '../../server/parse'
import { blobStore } from '../../server/infra'

export default async (req: Request) => handleTrending(req, { store: blobStore(getStore('trackr-cache')) })

export const config = { path: '/api/trending', rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } }
