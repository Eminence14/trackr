import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { addMentee, removeMentee, useAppState } from '../lib/store'
import { decodeSnapshot, type ShareSnapshot } from '../lib/share'
import { Empty, ProgressBar, toast } from '../components/ui'
import { diffDays, fmtDate, todayIn } from '../lib/dates'
import { statusLabel, type Status } from '../lib/types'

/** For teachers, counsellors and mentors: paste the mentor links students send you and see everyone on one page. */
export function Counsellor() {
  const { mentees, profile } = useAppState()
  const [text, setText] = useState('')
  const [snaps, setSnaps] = useState<Record<string, ShareSnapshot | null>>({})
  useEffect(() => {
    let live = true
    void Promise.all(mentees.map(async (m) => [m.id, await decodeSnapshot(m.token)] as const)).then((rows) => { if (live) setSnaps(Object.fromEntries(rows)) })
    return () => { live = false }
  }, [mentees])
  const today = todayIn(profile.tz)
  const rows = useMemo(() => mentees.map((m) => ({ m, s: snaps[m.id] })).filter((x): x is { m: typeof x.m; s: ShareSnapshot } => !!x.s).map(({ m, s }) => {
    const d = s.deadlines.filter((x) => x.kind !== 'opens').sort((a, b) => a.date.localeCompare(b.date))[0]
    return { m, s, date: d?.date, days: d ? diffDays(d.date, today) : undefined }
  }).sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9)), [mentees, snaps, today])

  async function add() {
    const tokens = Array.from(new Set((text.match(/\/s\/([A-Za-z0-9._-]+)/g) ?? []).map((x) => x.slice(3))))
    if (!tokens.length) { toast('Paste one or more mentor links (they contain /s/...)'); return }
    let ok = 0
    for (const t of tokens.slice(0, 100)) { const s = await decodeSnapshot(t); if (s && s.mode === 'mentor') { addMentee(t); ok++ } }
    toast(ok ? `${ok} added` : 'Those were not mentor links. Ask the student to use "Mentor link" on their application.')
    if (ok) setText('')
  }
  const atRisk = rows.filter((r) => r.days !== undefined && r.days >= 0 && r.days <= 14 && r.s.progress && r.s.progress.done < r.s.progress.total && ['saved', 'preparing'].includes(r.s.status ?? ''))

  return (
    <div className="stack lg">
      <div className="page-head"><div><h1>Counsellor view</h1><p className="sub small">See the progress students have shared with you in one place. Each row is a snapshot from the moment they made the link; ask for a fresh link to update it.</p></div></div>
      <div className="card stack">
        <textarea className="textarea" style={{ minHeight: 80 }} placeholder="Paste mentor links here, one or many" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!text.trim()} onClick={add}>Add students' links</button>
      </div>
      {atRisk.length > 0 && <div className="banner warn"><div><b>{atRisk.length} closing within two weeks and not ready</b><span>{atRisk.map((r) => `${r.s.from ?? 'Student'}: ${r.s.title}`).join('; ')}</span></div></div>}
      {rows.length === 0 ? <Empty title="No students yet" text="Students tap Mentor link on an application and send you the link. Paste it above." /> : (
        <div className="tablewrap"><table className="sheet"><thead><tr><th className="first">Student</th><th>Scholarship</th><th>Status</th><th>Checklist</th><th>Deadline</th><th>Shared</th><th /></tr></thead>
          <tbody>{rows.map(({ m, s, date, days }) => (
            <tr key={m.id}>
              <td className="first"><span className="cell">{s.from ?? 'Student'}</span></td>
              <td><a className="cell" href={`/s/${m.token}`} target="_blank" rel="noreferrer">{s.title}</a></td>
              <td><span className="cell">{s.status ? statusLabel(s.status as Status) : ''}</span></td>
              <td><span className="cell" style={{ minWidth: 120 }}>{s.progress ? <>{s.progress.done}/{s.progress.total}<ProgressBar value={s.progress.done} max={s.progress.total} /></> : ''}</span></td>
              <td><span className="cell">{date ? `${fmtDate(date)}${days !== undefined && days >= 0 ? ` (${days}d)` : ' (passed)'}` : 'None'}</span></td>
              <td><span className="cell">{new Date(s.at).toLocaleDateString()}</span></td>
              <td><button className="icon-btn" aria-label="Remove" onClick={() => removeMentee(m.id)}><Trash2 size={14} /></button></td>
            </tr>))}</tbody></table></div>
      )}
      <p className="hint">This is the free, single-counsellor version. School accounts with student rosters and billing are not built.</p>
    </div>
  )
}
