import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { VitePWA } from 'vite-plugin-pwa'

// Serves /api/parse during `npm run dev` using the same handler Netlify runs in production.
function apiDev(): Plugin {
  return {
    name: 'trackr-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/trending', async (_req, res) => {
        try {
          const mod = await server.ssrLoadModule('/server/parse.ts')
          const response: Response = await mod.handleTrending(new Request('http://localhost/api/trending'))
          res.statusCode = response.status
          res.setHeader('content-type', 'application/json')
          res.end(await response.text())
        } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e) })) }
      })
      server.middlewares.use('/api/parse', async (req, res) => {
        try {
          const mod = await server.ssrLoadModule('/server/parse.ts')
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const body = Buffer.concat(chunks)
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
          const request = new Request('http://localhost/api/parse', {
            method: req.method,
            headers,
            body: req.method === 'POST' ? body : undefined,
          })
          const response: Response = await mod.handleParse(request)
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (e) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // loadEnv lets values already in process.env win, and this config copies .env into process.env, so after the first start an
  // edited .env would be ignored. Clear the keys the .env files define, then load them fresh.
  for (const f of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    try { for (const m of readFileSync(f, 'utf8').matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) delete process.env[m[1]] } catch { /* file absent */ }
  }
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [
      react(),
      apiDev(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Trackr',
          short_name: 'Trackr',
          description: 'Track scholarship applications with ease. Share, paste or screenshot a link and Trackr fills the row.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#1A1245',
          theme_color: '#1A1245',
          categories: ['education', 'productivity'],
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          share_target: {
            action: '/share-target',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'media', accept: ['image/*'] }] },
          },
        } as any,
        injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,jpg,woff2}'], globIgnores: ['**/inter-{vietnamese,greek,greek-ext,cyrillic,cyrillic-ext}-*.woff2'] },
        devOptions: { enabled: false },
      }),
    ],
    test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
  }
})
