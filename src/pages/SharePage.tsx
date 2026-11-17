import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { openAdd } from '../components/addBus'

/** Landing for the Android share sheet (Web Share Target). Opens the add sheet pre-filled with what was shared. */
export function SharePage() {
  const [q] = useSearchParams()
  const h = new URLSearchParams(location.hash.replace(/^#/, ''))
  const p = { get: (k: string) => h.get(k) ?? q.get(k) }
  const nav = useNavigate()
  useEffect(() => {
    openAdd({ text: p.get('text') ?? [p.get('title')].filter(Boolean).join('\n'), url: p.get('url') ?? undefined, mediaCount: Number(p.get('media') || 0) })
    nav('/', { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="center" style={{ padding: 40 }}><span className="spin" /></div>
}
