import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { decodeSnapshot, importSnapshot, type ShareSnapshot } from '../lib/share'
import { useAppState } from '../lib/store'
import { Empty, ProgressBar, toast } from '../components/ui'
import { fmtLong } from '../lib/dates'
import { safeUrl } from '../lib/url'
import { statusLabel } from '../lib/types'
import type { Status } from '../lib/types'

export function Shared() {
  const { token = '' } = useParams()
  const nav = useNavigate()
  const { profile } = useAppState()
  const [s, setS] = useState<ShareSnapshot | null | undefined>(undefined)
  useEffect(() => { void decodeSnapshot(token).then(setS) }, [token])
  if (s === undefined) return <div className="center" style={{ padding: 40 }}><span className="spin" /></div>
  if (!s) return <Empty title="This link is broken" text="It may have been cut off when it was copied. Ask the sender to share it again."><Link className="btn" to="/">Open Trackr</Link></Empty>
  return (
    <div className="stack lg" style={{ maxWidth: 720 }}>
      <div className="banner info"><div><b>{s.mode === 'mentor' ? `${s.from ?? 'Someone'} shared their progress with you` : `${s.from ?? 'A friend'} sent you a scholarship`}</b><span>Shared {new Date(s.at).toLocaleDateString()}. Read-only snapshot.</span></div></div>
      <div><h1>{s.title}</h1><p className="sub">{[s.university, s.funder, s.degreeLevel, s.country].filter(Boolean).join(' · ')}</p></div>
      {s.status && <p><b>Status:</b> {statusLabel(s.status as Status)}</p>}
      {s.progress && s.progress.total > 0 && <div className="stack sm"><p className="small">Checklist {s.progress.done}/{s.progress.total}</p><ProgressBar value={s.progress.done} max={s.progress.total} /></div>}
      <section className="card stack"><h3>Dates</h3>{s.deadlines.map((d) => <p key={d.id}>{d.kind}: <b>{fmtLong(d.date)}</b>{d.time ? ` ${d.time}` : ''}{d.tz ? ` (${d.tz})` : ''}</p>)}{!s.deadlines.length && <p className="sub">No dates listed.</p>}</section>
      {s.funding.summary || s.funding.covers.length ? <section className="card stack"><h3>Funding</h3><p>{s.funding.summary ?? s.funding.covers.join(', ')}</p></section> : null}
      {s.requirements.length > 0 && <section className="card stack"><h3>Requirements</h3>{s.requirements.map((r, i) => <p key={i}>{s.mode === 'mentor' ? (r.done ? '✓ ' : '○ ') : '• '}{r.label}</p>)}</section>}
      <div className="row wrap">
        {s.officialUrl && <a className="btn" href={safeUrl(s.officialUrl)} target="_blank" rel="noreferrer noopener">Official page</a>}
        {s.mode === 'friend' && (profile.onboarded
          ? <button className="btn primary" onClick={() => { const id = importSnapshot(s); toast('Added to your tracker'); nav(`/app/${id}`) }}>Add to my Trackr</button>
          : <Link className="btn primary" to="/">Set up Trackr to add it</Link>)}
      </div>
      <p className="hint">Check dates on the official page before relying on them.</p>
    </div>
  )
}
