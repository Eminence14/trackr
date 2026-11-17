import { useEffect, useState, type ReactNode } from 'react'
import { X, Check } from 'lucide-react'
import type { Application, Status } from '../lib/types'
import { STATUSES, statusLabel } from '../lib/types'
import { deadlineDays, primaryDeadline } from '../lib/deadlines'
import { fmtDate, fmtRelative, toUserZone } from '../lib/dates'

export function StatusPill({ status }: { status: Status }) {
  return <span className={`pill ${status}`}>{statusLabel(status)}</span>
}

export function DeadlineChip({ app, tz }: { app: Application; tz: string }) {
  const d = primaryDeadline(app, tz)
  const days = deadlineDays(app, tz)
  if (!d || days === undefined) return <span className="dl">No deadline</span>
  const closed = ['submitted', 'interview', 'awarded', 'rejected', 'withdrawn'].includes(app.status)
  const local = toUserZone(d, tz)
  const cls = closed ? 'ok' : days < 0 ? 'past' : days <= 3 ? 'urgent' : days <= 14 ? 'soon' : ''
  return <span className={`dl ${cls}`} title={`${local.label}`}>{fmtDate(local.date)}{!closed && ` · ${fmtRelative(days)}`}</span>
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; icon?: ReactNode }[]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.icon}{o.label}</button>
      ))}
    </div>
  )
}

export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`sheet-panel${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// toasts
interface ToastItem { id: number; text: string; action?: { label: string; run: () => void } }
let toasts: ToastItem[] = []
const subs = new Set<() => void>()
let tid = 0
export function toast(text: string, action?: ToastItem['action']) {
  const item = { id: ++tid, text, action }
  toasts = [...toasts, item]
  subs.forEach((f) => f())
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== item.id); subs.forEach((f) => f()) }, action ? 7000 : 3500)
}
export function ToastHost() {
  const [, set] = useState(0)
  useEffect(() => { const f = () => set((n) => n + 1); subs.add(f); return () => { subs.delete(f) } }, [])
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>{t.text}{t.action && <button onClick={t.action.run}>{t.action.label}</button>}</div>
      ))}
    </div>
  )
}

export function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3><p>{text}</p>{children}</div>
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  return <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemax={max}><i style={{ width: `${max ? (value / max) * 100 : 0}%` }} /></div>
}

export function StatusStepper({ status, onChange }: { status: Status; onChange: (s: Status) => void }) {
  const main = STATUSES.slice(0, 5)
  const idx = main.findIndex((s) => s.id === status)
  const off = idx < 0
  return (
    <div>
      <div className="stepper" role="group" aria-label="Application status">
        {main.map((s, i) => (
          <button key={s.id} type="button" className={`step${!off && i < idx ? ' done' : ''}${!off && i === idx ? ' current' : ''}`} onClick={() => onChange(s.id)} title={s.hint}>
            <span className="dot">{!off && i < idx ? <Check size={14} /> : i + 1}</span>
            <span className="lab">{s.label}</span>
          </button>
        ))}
      </div>
      <div className="chips" style={{ marginTop: 8 }}>
        {STATUSES.slice(5).map((s) => (
          <button key={s.id} type="button" className="chip" aria-pressed={status === s.id} onClick={() => onChange(s.id)}>{s.label}</button>
        ))}
      </div>
    </div>
  )
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div><label className="label">{label}</label>{children}{hint && <p className="hint">{hint}</p>}</div>
}
