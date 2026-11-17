// Vercel entry for /api/parse. Bundled into api/parse.js by `npm run build:api`.
import { handleParse } from '../parse'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export async function POST(req: Request): Promise<Response> {
  // Vercel sets x-real-ip to the caller's address; it cannot be forged by the client.
  const clientId = req.headers.get('x-real-ip') ?? undefined
  return handleParse(req, { clientId, budgetMs: Number(process.env.PARSE_BUDGET_MS) || 15_000 })
}
export function GET(): Response { return json(405, { error: 'POST only' }) }
