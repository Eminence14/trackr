import { useAppState } from '../lib/store'
import { computeStats } from '../lib/stats'
import { STATUSES } from '../lib/types'
import { Empty } from '../components/ui'

const money = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => `${c} ${v.toLocaleString()}`).join(' + ') || '-'

export function Stats() {
  const { apps } = useAppState()
  if (!apps.length) return <Empty title="No numbers yet" text="Once you add and update applications, your results show up here." />
  const s = computeStats(apps)
  const max = Math.max(1, ...Object.values(s.byStatus))
  const year = new Date().getFullYear()
  return (
    <div className="stack lg">
      <div className="page-head"><div><h1>Insights</h1><p className="sub small">Your {year} so far. Only what you have logged.</p></div></div>
      <div className="statgrid">
        <div className="card stat"><b>{s.total}</b><span>Tracked</span></div>
        <div className="card stat"><b>{s.sent}</b><span>Applications sent</span></div>
        <div className="card stat"><b>{s.awarded}</b><span>Awarded</span></div>
        <div className="card stat"><b>{s.winRate === null ? '-' : `${Math.round(s.winRate * 100)}%`}</b><span>Success rate of decided</span></div>
        <div className="card stat"><b>{s.avgPrepDays ?? '-'}</b><span>Avg days to submit</span></div>
        <div className="card stat"><b>{s.fees ? s.fees.toLocaleString() : '0'}</b><span>Fees logged</span></div>
      </div>
      <section className="card stack"><h3>Pipeline</h3>{STATUSES.map((st) => (
        <div className="bar" key={st.id}><span className="t">{st.label}</span><span className="b"><i style={{ width: `${(s.byStatus[st.id] / max) * 100}%` }} /></span><span>{s.byStatus[st.id]}</span></div>))}</section>
      <section className="card stack"><h3>Funding</h3><p><b>Won:</b> {money(s.fundingWon)}</p><p><b>Still in play:</b> {money(s.fundingOpen)}</p><p className="hint">Amounts are summed per currency exactly as entered. No exchange rates are assumed.</p></section>
      {s.awarded > 0 && <div className="banner ok"><div><b>{s.awarded} award{s.awarded > 1 ? 's' : ''} this year</b><span>Well done. Remember to log acceptance deadlines on the application.</span></div></div>}
    </div>
  )
}
