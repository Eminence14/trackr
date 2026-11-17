import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAppState, upsertEssay, removeEssay } from '../lib/store'
import type { Essay } from '../lib/types'
import { Empty } from '../components/ui'
import { uid } from '../lib/ids'

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0)

export function Essays() {
  const { essays, apps } = useAppState()
  const [sel, setSel] = useState<string | null>(essays[0]?.id ?? null)
  const cur = essays.find((e) => e.id === sel)
  const save = (patch: Partial<Essay>) => cur && upsertEssay({ ...cur, ...patch, updatedAt: new Date().toISOString() })
  const create = () => { const e: Essay = { id: uid('es'), title: 'Untitled essay', prompt: '', body: '', tags: [], applicationIds: [], updatedAt: new Date().toISOString() }; upsertEssay(e); setSel(e.id) }
  return (
    <div className="stack lg">
      <div className="page-head"><div><h1>Essay library</h1><p className="sub small">Keep personal statements and answers, then reuse and adapt them.</p></div><button className="btn primary" onClick={create}><Plus size={16} /> New essay</button></div>
      {essays.length === 0 ? <Empty title="No essays yet" text="Write or paste a personal statement once. Link it to each application that uses a version of it."><button className="btn primary" onClick={create}>Start one</button></Empty> : (
        <div className="detail-grid" style={{ gridTemplateColumns: 'minmax(200px,1fr) minmax(0,2.4fr)' }}>
          <div className="card pad0">{essays.map((e) => <button key={e.id} className="item" style={{ width: '100%', border: 0, background: e.id === sel ? 'var(--brand-soft)' : 'transparent', textAlign: 'left' }} onClick={() => setSel(e.id)}><div className="grow"><div className="title truncate">{e.title}</div><div className="meta">{words(e.body)} words · used in {e.applicationIds.length}</div></div></button>)}</div>
          {cur && (
            <div className="card stack">
              <input className="input" style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 600 }} aria-label="Title" value={cur.title} onChange={(e) => save({ title: e.target.value })} />
              <input className="input" placeholder="The prompt or question (optional)" value={cur.prompt} onChange={(e) => save({ prompt: e.target.value })} />
              <textarea className="textarea" style={{ minHeight: 320 }} aria-label="Essay text" value={cur.body} onChange={(e) => save({ body: e.target.value })} placeholder="Write or paste here..." />
              <div className="row between small sub"><span>{words(cur.body)} words</span><button className="btn sm danger" onClick={() => { if (confirm('Delete this essay?')) { removeEssay(cur.id); setSel(null) } }}><Trash2 size={14} /> Delete</button></div>
              <div><label className="label">Used for</label>
                <div className="chips">{apps.length === 0 && <span className="muted small">No applications yet.</span>}{apps.map((a) => <button key={a.id} className="chip" aria-pressed={cur.applicationIds.includes(a.id)} onClick={() => save({ applicationIds: cur.applicationIds.includes(a.id) ? cur.applicationIds.filter((x) => x !== a.id) : [...cur.applicationIds, a.id] })}>{a.title}</button>)}</div></div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
