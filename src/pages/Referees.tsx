import { Mail, Plus, Trash2 } from 'lucide-react'
import { useAppState, upsertReferee, removeReferee } from '../lib/store'
import type { Referee } from '../lib/types'
import { Empty } from '../components/ui'
import { uid } from '../lib/ids'
import { diffDays, fmtLong, todayIn } from '../lib/dates'

export function Referees() {
  const { referees, apps, profile } = useAppState()
  const today = todayIn(profile.tz)
  const create = () => upsertReferee({ id: uid('rf'), name: '', email: '', org: '', asks: [], notes: '' })
  const set = (r: Referee, patch: Partial<Referee>) => upsertReferee({ ...r, ...patch })
  const open = apps.filter((a) => ['saved', 'preparing'].includes(a.status))
  return (
    <div className="stack lg">
      <div className="page-head"><div><h1>Referees</h1><p className="sub small">Track who you asked for which letter, and chase gently.</p></div><button className="btn primary" onClick={create}><Plus size={16} /> Add referee</button></div>
      {referees.length === 0 ? <Empty title="No referees yet" text="Add the people writing your recommendation letters. Log each request so none slips." /> : referees.map((r) => (
        <div className="card stack" key={r.id}>
          <div className="grid2">
            <input className="input" aria-label="Name" placeholder="Name" value={r.name} onChange={(e) => set(r, { name: e.target.value })} />
            <input className="input" aria-label="Email" type="email" placeholder="Email" value={r.email} onChange={(e) => set(r, { email: e.target.value })} />
          </div>
          <input className="input" aria-label="Position and institution" placeholder="Position and institution" value={r.org} onChange={(e) => set(r, { org: e.target.value })} />
          {r.asks.map((k) => {
            const a = apps.find((x) => x.id === k.applicationId)
            const waiting = !k.submittedAt ? diffDays(today, k.askedAt.slice(0, 10)) : 0
            return (
              <div className="row between wrap card flat" key={k.applicationId}>
                <div><b>{a?.title ?? 'Removed application'}</b><div className="small sub">Asked {fmtLong(k.askedAt.slice(0, 10))}{k.submittedAt ? `, submitted ${fmtLong(k.submittedAt.slice(0, 10))}` : ''}</div></div>
                {k.submittedAt ? <span className="tag ok">Submitted</span> : (
                  <div className="row">{waiting >= 10 && <span className="tag warn">Waiting {waiting} days</span>}
                    {r.email && <a className="btn sm" href={`mailto:${r.email}?subject=${encodeURIComponent(`Reminder: reference for ${a?.title ?? 'scholarship'}`)}&body=${encodeURIComponent(`Dear ${r.name || 'Professor'},\n\nA gentle reminder about my reference for ${a?.title ?? 'the scholarship'}. Please let me know if you need anything from me.\n\nThank you,\n${profile.name}`)}`}><Mail size={13} /> Chase</a>}
                    <button className="btn sm" onClick={() => set(r, { asks: r.asks.map((x) => (x === k ? { ...x, submittedAt: new Date().toISOString() } : x)) })}>Mark submitted</button></div>
                )}
              </div>)
          })}
          <div className="row between wrap">
            <select className="select" style={{ width: 'auto', maxWidth: '100%' }} aria-label="Log a request" value="" onChange={(e) => { if (e.target.value) set(r, { asks: [...r.asks, { applicationId: e.target.value, askedAt: new Date().toISOString() }] }) }}>
              <option value="">Log a request for...</option>{open.filter((a) => !r.asks.some((k) => k.applicationId === a.id)).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select>
            <button className="btn sm danger" onClick={() => { if (confirm('Remove this referee?')) removeReferee(r.id) }}><Trash2 size={14} /> Remove</button>
          </div>
        </div>
      ))}
    </div>
  )
}
