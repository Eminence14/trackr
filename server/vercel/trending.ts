// Vercel entry for /api/trending. Bundled into api/trending.js by `npm run build:api`.
import { handleTrending } from '../parse'

export async function GET(req: Request): Promise<Response> {
  const res = await handleTrending(req)
  // Let Vercel's edge cache hold the list for five minutes.
  res.headers.set('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600')
  return res
}
