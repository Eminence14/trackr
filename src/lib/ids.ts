export const uid = (p = ''): string => {
  const c: Crypto | undefined = (globalThis as any).crypto
  const r = c?.randomUUID ? c.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  return p ? `${p}_${r}` : r
}
