import { Link } from 'react-router-dom'
import { CalendarDown } from './icons'
import { useAppState, setStatus } from '../lib/store'
import { weekView } from '../lib/reminders'
import { Empty, DeadlineChip } from '../components/ui'
import { buildICS } from '../lib/ics'
import { downloadFile } from '../lib/download'
import { fmtLong, fmtRelative } from '../lib/dates'
import { DEADLINE_KINDS } from '../lib/types'

export function Week() {
  const { apps, tasks, profile } = useAppState()
  const w = weekView(apps, tasks, profile)
  const empty = !w.dueSoon.length && !w.blocked.length && !w.opening.length && !w.cycles.length && !w.overdueTasks.length && !w.suggestMissed.length

  function calendar() {
    const events = apps.filter((a) => ['saved', 'preparing', 'submitted', 'interview'].includes(a.status)).flatMap((a) => a.deadlines.filter((d) => d.kind !== 'opens').map((d) => ({
      uid: d.id, title: `${a.title}: ${DEADLINE_KINDS.find((k) => k.id === d.kind)?.label ?? 'Deadline'}`, date: d.date, time: d.time, tz: d.tz, url: a.officialUrl || a.sourceUrl,
    })))
    downloadFile('trackr-deadlines.ics', 'text/calendar', buildICS(events, profile.tz))
  }

  const Row = ({ id, title, right, sub }: { id: string; title: string; right: React.ReactNode; sub?: string }) => (
    <Link className="item" to={`/app/${id}`}><div className="grow"><div className="title truncate">{title}</div>{sub && <div className="meta">{sub}</div>}</div><div className="right">{right}</div></Link>
  )

  return (
    <div className="stack lg">
      <div className="page-head"><div><h1>This week</h1><p className="sub small">What needs you in the next few days.</p></div>
        <button className="btn" onClick={calendar}><CalendarDown size={16} /> Calendar file (.ics)</button></div>
      {empty && <Empty title="You are clear" text="Nothing closes this week and nothing is overdue. Add more opportunities to keep your pipeline full." />}
      {w.suggestMissed.length > 0 && (
        <section className="stack sm"><h3>Passed without applying</h3><div className="card pad0">{w.suggestMissed.map((a) => (
          <div className="item" key={a.id}><Link className="grow" to={`/app/${a.id}`}><div className="title">{a.title}</div></Link><button className="btn sm" onClick={() => setStatus(a.id, 'missed')}>Mark missed</button></div>))}</div></section>
      )}
      {w.dueSoon.length > 0 && <section className="stack sm"><h3>Closing in 7 days</h3><div className="card pad0">{w.dueSoon.map(({ app, days }) => <Row key={app.id} id={app.id} title={app.title} sub={app.requirements.length ? `${app.requirements.filter((r) => r.done).length}/${app.requirements.length} checklist items done` : undefined} right={<DeadlineChip app={app} tz={profile.tz} />} />)}</div></section>}
      {w.blocked.length > 0 && <section className="stack sm"><h3>Closing soon and not ready</h3><div className="card pad0">{w.blocked.map(({ app, days, left }) => <Row key={app.id} id={app.id} title={app.title} sub={`${left} item${left > 1 ? 's' : ''} still open`} right={<span className={`dl ${days <= 3 ? 'urgent' : 'soon'}`}>{fmtRelative(days)}</span>} />)}</div></section>}
      {w.overdueTasks.length > 0 && <section className="stack sm"><h3>Overdue plan steps</h3><div className="card pad0">{w.overdueTasks.map((t) => <Row key={t.id} id={t.applicationId} title={t.label} sub={apps.find((a) => a.id === t.applicationId)?.title} right={<span className="dl urgent">{fmtLong(t.due)}</span>} />)}</div></section>}
      {w.opening.length > 0 && <section className="stack sm"><h3>Opening soon</h3><div className="card pad0">{w.opening.map(({ app, days }) => <Row key={app.id} id={app.id} title={app.title} right={<span className="dl ok">opens {fmtRelative(days)}</span>} />)}</div></section>}
      {w.cycles.length > 0 && <section className="stack sm"><h3>Next cycle approaching</h3><div className="card pad0">{w.cycles.map(({ app, days }) => <Row key={app.id} id={app.id} title={app.title} sub="Previous application on file" right={<span className="dl">{fmtRelative(days)}</span>} />)}</div></section>}
    </div>
  )
}
