import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useAppState, patchApp, upsertOrg } from '../lib/store'
import { reviewReasons } from '../lib/deadlines'
import { markVerified } from '../lib/ingest'
import { Empty, toast } from '../components/ui'
import { uid } from '../lib/ids'
import { safeUrl } from '../lib/url'

export function Review() {
  const { apps, orgs } = useAppState()
  const list = apps.filter((a) => a.needsReview)
  return (
    <div className="stack lg">
      <div className="page-head"><div><h1>Review queue</h1><p className="sub small">Anything Trackr was not sure about waits here. A wrong deadline is worse than a slow one.</p></div></div>
      {list.length === 0 ? <Empty title="All checked" text="Nothing needs your attention." /> : list.map((a) => {
        const main = a.deadlines.find((d) => d.kind === 'scholarship') ?? a.deadlines.find((d) => d.kind !== 'opens')
        const org = orgs.find((o) => o.id === a.organisationId)
        return (
          <div className="card stack" key={a.id}>
            <div className="row between wrap"><Link to={`/app/${a.id}`}><b>{a.title || 'Untitled'}</b></Link><span className="tag warn">{reviewReasons(a)[0] ?? 'Check details'}</span></div>
            <div className="grid2">
              <div><label className="label">University</label><input className="input" defaultValue={org?.name ?? ''} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (org?.name ?? '')) patchApp(a.id, { organisationId: v ? upsertOrg(v, 'university') : null }) }} /></div>
              <div><label className="label">Deadline</label><input className="input" type="date" defaultValue={main?.date ?? ''} onBlur={(e) => {
                const v = e.target.value
                if (!v) return
                patchApp(a.id, { deadlines: main ? a.deadlines.map((d) => (d === main ? { ...d, date: v } : d)) : [...a.deadlines, { id: uid('dl'), kind: 'scholarship', date: v }] })
              }} /></div>
            </div>
            {reviewReasons(a).length > 1 && <ul className="small sub" style={{ margin: 0, paddingLeft: 18 }}>{reviewReasons(a).map((r) => <li key={r}>{r}</li>)}</ul>}
            <div className="row wrap">
              {a.sourceUrl && <a className="btn sm" href={safeUrl(a.sourceUrl)} target="_blank" rel="noreferrer noopener">Open source</a>}
              {a.officialUrl && <a className="btn sm" href={safeUrl(a.officialUrl)} target="_blank" rel="noreferrer noopener">Official page</a>}
              <Link className="btn sm" to={`/app/${a.id}`}>Open details</Link>
              <button className="btn sm primary" style={{ marginLeft: 'auto' }} onClick={() => { markVerified(a.id); toast('Marked as checked') }}><CheckCircle2 size={14} /> Looks right</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
