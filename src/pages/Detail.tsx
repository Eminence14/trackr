import { Fragment, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, CheckCircle2, CircleAlert, ExternalLink, Plus, RefreshCw, Send, Share2, ShieldAlert, Trash2, Users } from 'lucide-react'
import { useAppState, patchApp, removeApp, setStatus, toggleRequirement, upsertOrg, updateOrg, setTasksForApp, toggleTask, addTask } from '../lib/store'
import { StatusStepper, ProgressBar, Empty, toast, Field } from '../components/ui'
import type { Application, Deadline, DeadlineKind, RequirementKind } from '../lib/types'
import { DEADLINE_KINDS, statusLabel } from '../lib/types'
import { daysLeft, fmtLong, fmtRelative, toUserZone, COMMON_TZS, addDays, todayIn } from '../lib/dates'
import { markVerified } from '../lib/ingest'
import { reviewReasons } from '../lib/deadlines'
import { evaluate, verdictLabel } from '../lib/eligibility'
import { generateTasks } from '../lib/planner'
import { buildICS } from '../lib/ics'
import { downloadFile } from '../lib/download'
import { buildSnapshot, encodeSnapshot } from '../lib/share'
import { hostOf, safeUrl, tidyUrl } from '../lib/url'
import { uid } from '../lib/ids'
import { useThumb } from '../lib/thumbs'

export function Detail() {
  const { id } = useParams()
  const nav = useNavigate()
  const state = useAppState()
  const { profile, orgs, tasks } = state
  const app = state.apps.find((a) => a.id === id)
  const [newReq, setNewReq] = useState('')
  const thumb = useThumb(app?.id, app?.hasThumb, app?.thumbnail)
  if (!app) return <Empty title="Not found" text="This application is no longer in your tracker."><Link className="btn" to="/">Back to tracker</Link></Empty>
  const org = orgs.find((o) => o.id === app.organisationId)
  const elig = evaluate(app, profile)
  const reasons = reviewReasons(app)
  const done = app.requirements.filter((r) => r.done).length
  const myTasks = tasks.filter((t) => t.applicationId === app.id).sort((a, b) => a.due.localeCompare(b.due))
  const today = todayIn(profile.tz)
  const main = app.deadlines.filter((d) => d.kind !== 'opens').sort((a, b) => a.date.localeCompare(b.date))[0]
  const pastDue = main && ['saved', 'preparing'].includes(app.status) && daysLeft(main, profile.tz) < 0

  const patchDeadline = (d: Deadline, patch: Partial<Deadline>) => patchApp(app.id, { deadlines: app.deadlines.map((x) => (x.id === d.id ? { ...x, ...patch } : x)) })
  const addDeadline = () => patchApp(app.id, { deadlines: [...app.deadlines, { id: uid('dl'), kind: 'scholarship', date: addDays(today, 30) }] })

  function exportIcs() {
    const events = app!.deadlines.filter((d) => d.kind !== 'opens').map((d) => ({ uid: d.id, title: `${app!.title}: ${DEADLINE_KINDS.find((k) => k.id === d.kind)?.label ?? 'Deadline'}`, date: d.date, time: d.time, tz: d.tz, url: app!.officialUrl || app!.sourceUrl }))
    downloadFile(`${(app!.title || 'deadline').replace(/[^\w]+/g, '-').slice(0, 40)}.ics`, 'text/calendar', buildICS(events, profile.tz))
  }

  async function share(mode: 'mentor' | 'friend') {
    const token = await encodeSnapshot(buildSnapshot(app!, mode, org?.name, profile.name || undefined))
    const url = `${location.origin}/s/${token}`
    try {
      if (navigator.share) await navigator.share({ title: app!.title, text: mode === 'friend' ? `Scholarship I found: ${app!.title}` : `My progress on ${app!.title}`, url })
      else { await navigator.clipboard.writeText(url); toast('Link copied') }
    } catch { /* user cancelled */ }
  }

  return (
    <div className="stack lg">
      <div className="row between wrap">
        <button className="btn ghost sm" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))}><ArrowLeft size={16} /> Back</button>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn sm" onClick={exportIcs}><CalendarPlus size={14} /> Add to calendar</button>
          <button className="btn sm" onClick={() => share('mentor')}><Users size={14} /> Mentor link</button>
          <button className="btn sm" onClick={() => share('friend')}><Send size={14} /> Send to a friend</button>
          <button className="btn sm danger" onClick={() => { if (confirm('Delete this application?')) { removeApp(app.id); nav('/') } }} aria-label="Delete"><Trash2 size={14} /></button>
        </div>
      </div>

      <div>
        <input className="input" style={{ fontFamily: 'var(--display)', fontSize: 24, fontWeight: 600, border: 0, padding: '4px 0', background: 'transparent' }} aria-label="Scholarship name" value={app.title} onChange={(e) => patchApp(app.id, { title: e.target.value })} placeholder="Scholarship name" />
        <div className="row wrap small sub" style={{ gap: 14 }}>
          <label className="row" style={{ gap: 6 }}>University:
            <input className="input" style={{ width: 220, padding: '4px 8px' }} list="orgs" defaultValue={org?.name ?? ''} key={org?.id ?? 'none'} placeholder="Add university" onBlur={(e) => { const v = e.target.value.trim(); if (v !== (org?.name ?? '')) patchApp(app.id, { organisationId: v ? upsertOrg(v, 'university') : null }) }} />
          </label>
          <datalist id="orgs">{orgs.filter((o) => o.kind === 'university').map((o) => <option key={o.id} value={o.name} />)}</datalist>
          <label className="row" style={{ gap: 6 }}>Funder:
            <input className="input" style={{ width: 180, padding: '4px 8px' }} defaultValue={app.funder ?? ''} placeholder="e.g. Chevening" onBlur={(e) => patchApp(app.id, { funder: e.target.value.trim() || null })} />
          </label>
        </div>
      </div>

      {app.needsReview && (
        <div className="banner warn"><CircleAlert size={18} /><div className="grow"><b>Please check this one</b><span>{reasons.map((r) => r.replace(/\.?$/, '.')).join(' ') || 'Some details were read with low confidence.'} Compare with the source, fix anything wrong, then confirm.</span></div>
          <button className="btn sm primary" onClick={() => { markVerified(app.id); toast('Marked as checked') }}><CheckCircle2 size={14} /> Looks right</button></div>
      )}
      {(app.scamFlags.some((f) => f.severity === 'high') || app.scamFlags.length >= 2) && (
        <div className="banner bad"><ShieldAlert size={18} /><div><b>Possible scam signals</b><span>{app.scamFlags.map((f) => f.text).join(' ')} Confirm on the official website before sharing documents or paying anything.</span></div></div>
      )}
      {app.changeNote && (
        <div className="banner info"><CircleAlert size={18} /><div className="grow"><b>The deadline may have changed</b><span>{app.changeNote} Check the official page before you decide.</span></div>
          <div className="row wrap">
            {app.pendingDeadline && <button className="btn sm primary" onClick={() => { const p = app.pendingDeadline!; const mine = app.deadlines.find((d) => d.kind === 'scholarship') ?? app.deadlines.find((d) => d.kind !== 'opens'); patchApp(app.id, { deadlines: mine ? app.deadlines.map((d) => (d === mine ? { ...d, ...p } : d)) : [...app.deadlines, { id: uid('dl'), kind: 'scholarship', ...p }], changeNote: undefined, pendingDeadline: undefined }); toast('Deadline updated') }}>Use the new date</button>}
            <button className="btn sm" onClick={() => patchApp(app.id, { changeNote: undefined, pendingDeadline: undefined })}>Keep mine</button>
          </div></div>
      )}
      {pastDue && (
        <div className="banner warn"><CircleAlert size={18} /><div className="grow"><b>The deadline has passed</b><span>If you did not apply, mark it missed to keep your tracker honest.</span></div><button className="btn sm" onClick={() => setStatus(app.id, 'missed')}>Mark missed</button></div>
      )}

      <div className="card"><StatusStepper status={app.status} onChange={(s) => setStatus(app.id, s)} /></div>

      <div className="detail-grid">
        <div className="stack lg">
          <section className="card stack">
            <div className="row between"><h3>Key dates</h3><button className="btn sm" onClick={addDeadline}><Plus size={14} /> Add date</button></div>
            {app.deadlines.length === 0 && <p className="sub small">No dates yet. Add the deadline so reminders can start.</p>}
            {app.deadlines.map((d) => {
              const local = toUserZone(d, profile.tz)
              const days = daysLeft(d, profile.tz)
              return (
                <div className="card flat stack sm" key={d.id}>
                  <div className="row between wrap">
                    <select className="select" style={{ width: 'auto' }} value={d.kind} aria-label="Date type" onChange={(e) => patchDeadline(d, { kind: e.target.value as DeadlineKind })}>{DEADLINE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
                    <button className="icon-btn" aria-label="Remove date" onClick={() => patchApp(app.id, { deadlines: app.deadlines.filter((x) => x.id !== d.id) })}><Trash2 size={15} /></button>
                  </div>
                  <div className="row wrap">
                    <input className="input" style={{ width: 160 }} type="date" aria-label="Date" value={d.date} onChange={(e) => e.target.value && patchDeadline(d, { date: e.target.value })} />
                    <input className="input" style={{ width: 120 }} type="time" aria-label="Time" value={d.time ?? ''} onChange={(e) => patchDeadline(d, { time: e.target.value || undefined })} />
                    <select className="select" style={{ width: 'auto' }} aria-label="Time zone of this deadline" value={d.tz ?? ''} onChange={(e) => patchDeadline(d, { tz: e.target.value || undefined })}><option value="">Zone not stated</option>{Array.from(new Set([...(d.tz ? [d.tz] : []), ...COMMON_TZS])).map((z) => <option key={z}>{z}</option>)}</select>
                  </div>
                  <p className="small"><b>{fmtLong(local.date)}{local.time ? `, ${local.time}` : ''}</b> in your time{d.tz && d.tz !== profile.tz && d.time ? ` (${d.time} ${d.tz})` : ''} · <span className="sub">{d.kind === 'opens' ? 'opens' : 'closes'} {fmtRelative(days)}</span></p>
                  {!d.time && d.kind !== 'opens' && <p className="hint">No closing time listed. Treat the end of the day in the funder's own time zone as the limit.</p>}
                </div>
              )
            })}
            {app.nextCycleOn && <p className="small sub">Next cycle expected around {fmtLong(app.nextCycleOn)}.</p>}
          </section>

          <section className="card stack">
            <div className="row between"><h3>Am I eligible?</h3><span className={`tag ${elig.verdict === 'eligible' ? 'ok' : elig.verdict === 'check' ? 'warn' : 'bad'}`}>{verdictLabel[elig.verdict]}</span></div>
            {elig.lines.map((l, i) => <p key={i} className="small row" style={{ alignItems: 'flex-start' }}><span aria-hidden>{l.ok === true ? '✓' : l.ok === false ? '✗' : '?'}</span><span>{l.text}</span></p>)}
            <p className="hint">Based on your profile and what the post says. Always confirm on the official page.</p>
          </section>

          <section className="card stack">
            <div className="row between"><h3>Checklist</h3><span className="small muted">{done}/{app.requirements.length}</span></div>
            {app.requirements.length > 0 && <ProgressBar value={done} max={app.requirements.length} />}
            <div>
              {app.requirements.map((r) => (
                <label className={`todo${r.done ? ' done' : ''}`} key={r.id}><input type="checkbox" checked={r.done} onChange={() => toggleRequirement(app.id, r.id)} /><span className="grow">{r.label}{r.note && /^https?:/.test(r.note) && <> <a href={safeUrl(r.note)} target="_blank" rel="noreferrer noopener">Open</a></>}</span><span className="tag">{r.kind}</span>
                  <button className="icon-btn" type="button" aria-label="Remove" onClick={(e) => { e.preventDefault(); patchApp(app.id, { requirements: app.requirements.filter((x) => x.id !== r.id) }) }}><Trash2 size={14} /></button></label>
              ))}
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); const l = newReq.trim(); if (!l) return; patchApp(app.id, { requirements: [...app.requirements, { id: uid('rq'), label: l, kind: 'document' as RequirementKind, done: false }] }); setNewReq('') }}>
              <input className="input" placeholder="Add a requirement" value={newReq} onChange={(e) => setNewReq(e.target.value)} /><button className="btn">Add</button>
            </form>
          </section>

          <section className="card stack">
            <div className="row between"><h3>Your plan</h3>
              <button className="btn sm" onClick={() => { setTasksForApp(app.id, generateTasks(app, profile.tz)); toast('Plan rebuilt from the deadline') }}><RefreshCw size={14} /> Rebuild</button></div>
            {myTasks.length === 0 ? <p className="sub small">A step-by-step plan appears once there is a deadline.</p> : myTasks.map((t) => (
              <label className={`todo${t.done ? ' done' : ''}`} key={t.id}><input type="checkbox" checked={t.done} onChange={() => toggleTask(t.id)} /><span className="grow">{t.label}</span><span className={`dl ${!t.done && t.due < today ? 'urgent' : ''}`}>{fmtLong(t.due)}</span></label>
            ))}
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => { const label = prompt('Task'); if (label) addTask({ id: uid('tk'), applicationId: app.id, label, due: addDays(today, 7), done: false, auto: false }) }}><Plus size={14} /> Add task</button>
          </section>

          <section className="card stack">
            <h3>Notes</h3>
            <textarea className="textarea" value={app.notes} onChange={(e) => patchApp(app.id, { notes: e.target.value })} placeholder="Contacts, ideas, things to ask..." />
          </section>
        </div>

        <div className="stack lg">
          <section className="card stack">
            <h3>Programme and funding</h3>
            <dl className="kv">
              <dt>Programme</dt><dd><input className="input" defaultValue={app.programme} onBlur={(e) => patchApp(app.id, { programme: e.target.value })} /></dd>
              <dt>Level</dt><dd><input className="input" defaultValue={app.degreeLevel} onBlur={(e) => patchApp(app.id, { degreeLevel: e.target.value })} /></dd>
              <dt>Country</dt><dd><input className="input" defaultValue={app.country} onBlur={(e) => patchApp(app.id, { country: e.target.value })} /></dd>
              <dt>Funding</dt><dd><select className="select" value={app.funding.type ?? 'unknown'} onChange={(e) => patchApp(app.id, { funding: { ...app.funding, type: e.target.value as 'full' | 'partial' | 'unknown' } })}><option value="unknown">Not stated</option><option value="full">Fully funded</option><option value="partial">Partly funded</option></select></dd>
              <dt>Covers</dt><dd>{app.funding.covers.length ? app.funding.covers.join(', ') : <span className="muted">Not stated</span>}</dd>
              <dt>Amount</dt><dd className="row"><input className="input" type="number" style={{ width: 120 }} min={0} defaultValue={app.funding.amount ?? ''} onBlur={(e) => patchApp(app.id, { funding: { ...app.funding, amount: e.target.value && Number(e.target.value) >= 0 ? Number(e.target.value) : undefined } })} /><input className="input" style={{ width: 80 }} placeholder="USD" defaultValue={app.funding.currency ?? ''} onBlur={(e) => patchApp(app.id, { funding: { ...app.funding, currency: e.target.value.toUpperCase() || undefined } })} /></dd>
              <dt>Application fee</dt><dd><input className="input" type="number" style={{ width: 140 }} min={0} defaultValue={app.fee ?? ''} onBlur={(e) => patchApp(app.id, { fee: e.target.value && Number(e.target.value) >= 0 ? Number(e.target.value) : undefined })} /></dd>
              <dt>Next cycle</dt><dd><input className="input" type="date" style={{ width: 170 }} value={app.nextCycleOn ?? ''} onChange={(e) => patchApp(app.id, { nextCycleOn: e.target.value || undefined })} /></dd>
            </dl>
            {summarise(app).map((x) => <p key={x} className="small sub">{x}</p>)}
            {state.fields.some((f) => !f.isDefault) && (
              <dl className="kv">{state.fields.filter((f) => !f.isDefault).map((f) => (
                <Fragment key={f.id}><dt>{f.label}</dt><dd>
                  {f.type === 'select' && f.options?.length
                    ? <select className="select" value={app.custom[f.key] ?? ''} onChange={(e) => patchApp(app.id, { custom: { ...app.custom, [f.key]: e.target.value } })}><option value="" />{f.options.map((o) => <option key={o}>{o}</option>)}</select>
                    : <input className="input" type={f.type === 'date' ? 'date' : f.type === 'number' || f.type === 'money' ? 'number' : 'text'} defaultValue={app.custom[f.key] ?? ''} key={app.custom[f.key] ?? ''} onBlur={(e) => { if (e.target.value !== (app.custom[f.key] ?? '')) patchApp(app.id, { custom: { ...app.custom, [f.key]: e.target.value } }) }} />}
                </dd></Fragment>))}</dl>
            )}
          </section>

          {org && (
            <section className="card stack">
              <h3>{org.name}</h3>
              <Field label="Website"><input className="input" defaultValue={org.website ?? ''} placeholder="https://" onBlur={(e) => updateOrg(org.id, { website: tidyUrl(e.target.value) })} /></Field>
              <Field label="Admissions page"><input className="input" defaultValue={org.admissionsUrl ?? ''} placeholder="https://" onBlur={(e) => updateOrg(org.id, { admissionsUrl: tidyUrl(e.target.value) })} /></Field>
              <Field label="City"><input className="input" defaultValue={org.city ?? ''} onBlur={(e) => updateOrg(org.id, { city: e.target.value })} /></Field>
              <div className="row wrap">
                <a className="btn sm" href={`https://www.google.com/search?q=${encodeURIComponent(org.name + ' official website')}`} target="_blank" rel="noreferrer noopener">Find website</a>
                <a className="btn sm" href={`https://www.google.com/search?q=${encodeURIComponent(org.name + ' graduate admissions deadlines')}`} target="_blank" rel="noreferrer noopener">Find admissions deadlines</a>
              </div>
              <p className="small sub">{state.apps.filter((a) => a.organisationId === org.id).length} application(s) at this university.</p>
            </section>
          )}

          <section className="card stack">
            <h3>Source</h3>
            {thumb && <img className="thumb" src={thumb} alt="Screenshot this was read from" />}
            <p className="small sub">Found via {app.sourceKind}</p>
            {app.sourceUrl && <a className="small row" href={safeUrl(app.sourceUrl)} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} /> {hostOf(app.sourceUrl)}</a>}
            {app.officialUrl ? <a className="btn sm" href={safeUrl(app.officialUrl)} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} /> Official page ({hostOf(app.officialUrl)})</a> : <p className="small warn-text" style={{ color: 'var(--warn)' }}>No official page found yet. Search for the funder's own site before applying.</p>}
            <Field label="Official link"><input className="input" defaultValue={app.officialUrl} placeholder="https://" key={app.officialUrl} onBlur={(e) => { const v = tidyUrl(e.target.value); if (e.target.value.trim() && !v) toast('That does not look like a web link'); patchApp(app.id, { officialUrl: v }) }} /></Field>
            {Object.keys(app.evidence).length > 0 && (
              <details><summary className="small">What the reader based this on</summary>
                {Object.entries(app.evidence).map(([k, v]) => <p key={k} className="small sub" style={{ marginTop: 6 }}><b>{k}</b>: "{v}"{app.confidence[k] !== undefined && app.confidence[k] < 0.7 ? ' (unsure)' : ''}</p>)}</details>
            )}
          </section>

          <section className="card stack">
            <h3>History</h3>
            {app.history.length === 0 ? <p className="small sub">Added {new Date(app.createdAt).toLocaleDateString()}.</p> : app.history.slice().reverse().map((h, i) => (
              <p key={i} className="small sub">{new Date(h.at).toLocaleDateString()}: {h.from ? `${statusLabel(h.from)} to ` : ''}{statusLabel(h.to)}</p>
            ))}
            <p className="hint"><Share2 size={12} style={{ verticalAlign: -1 }} /> Mentor links show progress only; they never include your documents or notes.</p>
          </section>
        </div>
      </div>
    </div>
  )
}

function summarise(app: Application): string[] {
  const out: string[] = []
  const c = app.criteria
  if (c.nationalities.length) out.push(`Open to: ${c.nationalities.join(', ')}`)
  if (c.degreeLevels.length) out.push(`Levels: ${c.degreeLevels.join(', ')}`)
  if (c.fields.length) out.push(`Fields: ${c.fields.join(', ')}`)
  if (c.minGpa) out.push(`Minimum grade: ${c.minGpa}`)
  if (c.maxAge) out.push(`Age limit: ${c.maxAge}`)
  c.other.forEach((o) => out.push(o))
  return out
}
