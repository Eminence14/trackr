import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Empty, toast } from '../components/ui'
import { captureOne } from '../lib/capture'
import { fmtDate, isValidISO } from '../lib/dates'
import { hostOf, safeUrl } from '../lib/url'
import { findDuplicate } from '../lib/ingest'
import { useAppState } from '../lib/store'

interface Item { url: string; title: string; university?: string; funder?: string; deadline?: string; country?: string; count: number }

export function Trending() {
  const nav = useNavigate()
  useAppState() // re-render when something is added so "In your tracker" updates
  const [items, setItems] = useState<Item[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState('')
  useEffect(() => {
    fetch('/api/trending').then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => setItems((Array.isArray(j?.items) ? j.items : []).filter((x: Item) => x && typeof x.title === 'string' && safeUrl(x.url)))).catch(() => { setFailed(true); setItems([]) })
  }, [])
  async function add(it: Item) {
    setBusy(it.url)
    const o = await captureOne({ kind: 'link', url: it.url })
    setBusy('')
    if (o.id) { toast(o.duplicate ? 'Already in your tracker' : 'Added'); nav(`/app/${o.id}`) } else toast(o.note ?? 'Could not add that')
  }
  return (
    <div className="stack lg">
      <div className="page-head"><div><h1>Trending</h1><p className="sub small">Public scholarship pages that several Trackr users have added recently. Only links are counted, never pasted messages, screenshots or who added them.</p></div></div>
      {items === null ? <div className="center"><span className="spin" /></div> : items.length === 0 ? (
        <Empty title={failed ? 'Could not load trending' : 'Nothing trending yet'} text={failed ? 'Check your connection and try again.' : 'This fills in once the same public link has been added by more than one person.'} />
      ) : (
        <div className="card pad0">{items.map((it) => {
          const mine = !!findDuplicate(it.url, '', '', undefined)
          return (
            <div className="item" key={it.url}>
              <div className="grow"><div className="title">{it.title.slice(0, 160)}</div>
                <div className="meta">{[it.university, it.funder, it.country, hostOf(it.url)].filter(Boolean).join(' · ')}</div>
                <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>{isValidISO(it.deadline) && <span className="dl">Closes {fmtDate(it.deadline)}</span>}<span className="tag">Added {it.count} times</span></div></div>
              {mine ? <span className="tag ok">In your tracker</span> : <button className="btn sm primary" disabled={busy === it.url} onClick={() => add(it)}>{busy === it.url ? <span className="spin" /> : <Plus size={14} />} Add</button>}
            </div>)
        })}</div>
      )}
    </div>
  )
}
