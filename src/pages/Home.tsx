import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Columns3, Download, LayoutList, Plus, Search, Settings2, Sheet as SheetIcon, Trash2, ShieldAlert, Upload } from 'lucide-react'
import { useAppState, updateProfile, patchApp, setStatus, upsertOrg, addField, updateField, removeField } from '../lib/store'
import type { Application, FieldDef, FieldType, Status } from '../lib/types'
import { STATUSES, ACTIVE_STATUSES } from '../lib/types'
import { deadlineDays, primaryDeadline } from '../lib/deadlines'
import { Segmented, StatusPill, DeadlineChip, Empty, Sheet, initials, Field } from '../components/ui'
import { openAdd } from '../components/addBus'
import { applicationsToCSV } from '../lib/csv'
import { downloadFile } from '../lib/download'
import { uid } from '../lib/ids'
import { dueReminders } from '../lib/reminders'

type Sort = { key: string; dir: 1 | -1 }

export function Home() {
  const state = useAppState()
  const { profile, apps, orgs, fields } = state
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'active' | 'all' | Status>('active')
  const [sort, setSort] = useState<Sort>({ key: 'deadline', dir: 1 })
  const [cols, setCols] = useState(false)
  const orgName = (id: string | null) => orgs.find((o) => o.id === id)?.name ?? ''

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return apps.filter((a) => {
      if (filter === 'active' ? !ACTIVE_STATUSES.includes(a.status) : filter !== 'all' && a.status !== filter) return false
      if (!needle) return true
      return [a.title, orgName(a.organisationId), a.funder ?? '', a.country, a.programme, a.notes].join(' ').toLowerCase().includes(needle)
    })
  }, [apps, orgs, q, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const byDeadline = (a: Application, b: Application) => {
    const da = deadlineDays(a, profile.tz), db = deadlineDays(b, profile.tz)
    const va = da === undefined ? 1e9 : da < 0 ? 1e6 - da : da
    const vb = db === undefined ? 1e9 : db < 0 ? 1e6 - db : db
    return va - vb
  }

  const urgent = dueReminders(apps, profile).filter((r) => r.level !== 'info').slice(0, 3)
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: apps.length, active: apps.filter((a) => ACTIVE_STATUSES.includes(a.status)).length }
    for (const s of STATUSES) c[s.id] = apps.filter((a) => a.status === s.id).length
    return c
  }, [apps])

  return (
    <div>
      <div className="page-head">
        <div><h1>{profile.name ? `${profile.name}'s tracker` : 'Your tracker'}</h1><p className="sub small">{counts.active} active · {counts.all} total</p></div>
        <Segmented label="View" value={profile.view} onChange={(v) => updateProfile({ view: v })} options={[
          { id: 'list', label: 'Universities', icon: <LayoutList size={15} /> }, { id: 'table', label: 'Spreadsheet', icon: <SheetIcon size={15} /> }, { id: 'board', label: 'Board', icon: <Columns3 size={15} /> },
        ]} />
      </div>

      {urgent.length > 0 && (
        <div className="banner bad" style={{ marginBottom: 14 }}>
          <div className="grow"><b>Closing soon</b>
            {urgent.map((r) => <Link key={r.id} to={`/app/${r.appId}`} style={{ display: 'block', color: 'inherit' }}>{r.title}: {r.text}</Link>)}</div>
        </div>
      )}

      {apps.length > 0 && (
        <div className="toolbar">
          <div className="search"><Search size={16} /><input className="input" placeholder="Search scholarships, universities, countries" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {profile.view === 'list' && <Segmented label="Group by" value={profile.groupBy} onChange={(v) => updateProfile({ groupBy: v })} options={[{ id: 'university', label: 'University' }, { id: 'funder', label: 'Funder' }]} />}
          {profile.view === 'table' && <>
            <button className="btn sm" onClick={() => setCols(true)}><Settings2 size={14} /> Columns</button>
            <button className="btn sm" onClick={() => downloadFile('trackr.csv', 'text/csv;charset=utf-8', '﻿' + applicationsToCSV(filtered, orgName, fields))}><Download size={14} /> CSV</button>
            <Link className="btn sm" to="/import"><Upload size={14} /> Import</Link>
          </>}
        </div>
      )}
      {apps.length > 0 && profile.view !== 'board' && (
        <div className="chips" style={{ marginBottom: 14 }}>
          {([['active', 'Active'], ['all', 'All'], ...STATUSES.map((s) => [s.id, s.label])] as [string, string][]).map(([id, label]) => (
            <button key={id} className="chip" aria-pressed={filter === id} onClick={() => setFilter(id as typeof filter)}>{label} {counts[id] ?? 0}</button>
          ))}
        </div>
      )}

      {apps.length === 0 ? (
        <Empty title="Nothing tracked yet" text="Paste a scholarship link, a WhatsApp message, or a screenshot. Trackr files the university and deadline for you.">
          <div className="row wrap" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => openAdd()}><Plus size={16} /> Add your first one</button>
            <Link className="btn" to="/import"><Upload size={16} /> Import a spreadsheet</Link>
          </div>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty title="No matches" text="Try a different search or filter." />
      ) : profile.view === 'list' ? (
        <ListView apps={filtered.slice().sort(byDeadline)} orgName={orgName} groupBy={profile.groupBy} tz={profile.tz} />
      ) : profile.view === 'table' ? (
        <TableView apps={filtered} orgName={orgName} fields={fields} sort={sort} setSort={setSort} tz={profile.tz} />
      ) : (
        <BoardView apps={apps.filter((a) => !q.trim() || filtered.includes(a))} orgName={orgName} tz={profile.tz} />
      )}
      <Sheet open={cols} onClose={() => setCols(false)} title="Columns"><ColumnEditor fields={fields} /></Sheet>
    </div>
  )
}

function Flags({ a }: { a: Application }) {
  return <>
    {a.needsReview && <span className="tag warn">Needs review</span>}
    {a.scamFlags.some((f) => f.severity === 'high') && <span className="tag bad"><ShieldAlert size={12} /> Check source</span>}
  </>
}

function ListView({ apps, orgName, groupBy, tz }: { apps: Application[]; orgName: (id: string | null) => string; groupBy: 'university' | 'funder'; tz: string }) {
  const groups = useMemo(() => {
    const m = new Map<string, Application[]>()
    for (const a of apps) {
      const key = (groupBy === 'university' ? orgName(a.organisationId) : a.funder ?? '') || (groupBy === 'university' ? 'No university yet' : 'No funder listed')
      m.set(key, [...(m.get(key) ?? []), a])
    }
    return Array.from(m.entries())
  }, [apps, groupBy]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      {groups.map(([name, list]) => (
        <section className="group" key={name}>
          <div className="group-head"><span className="uni-avatar">{initials(name)}</span><h3>{name}</h3><span className="count">{list.length} {list.length === 1 ? 'application' : 'applications'}</span></div>
          <div className="card pad0">
            {list.map((a) => (
              <Link className="item" key={a.id} to={`/app/${a.id}`}>
                <div className="grow">
                  <div className="title truncate">{a.title || 'Untitled'}</div>
                  <div className="meta truncate">{[groupBy === 'university' ? a.funder : orgName(a.organisationId), a.degreeLevel, a.country, a.funding.type === 'full' ? 'Fully funded' : ''].filter(Boolean).join(' · ') || a.sourceKind}</div>
                  <div className="row wrap" style={{ marginTop: 6, gap: 6 }}><Flags a={a} /></div>
                </div>
                <div className="right"><StatusPill status={a.status} /><DeadlineChip app={a} tz={tz} /></div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function cellValue(a: Application, key: string, orgName: (id: string | null) => string, tz: string): string {
  switch (key) {
    case 'title': return a.title
    case 'institution': return orgName(a.organisationId)
    case 'funder': return a.funder ?? ''
    case 'deadline': return primaryDeadline(a, tz)?.date ?? ''
    case 'status': return a.status
    case 'country': return a.country
    case 'programme': return a.programme
    case 'funding': return a.funding.summary ?? a.funding.type ?? ''
    default: return a.custom[key] ?? ''
  }
}

function setMainDeadline(a: Application, date: string) {
  const main = a.deadlines.find((d) => d.kind === 'scholarship') ?? a.deadlines.find((d) => d.kind !== 'opens')
  if (!date) return patchApp(a.id, { deadlines: a.deadlines.filter((d) => d !== main) })
  if (main) return patchApp(a.id, { deadlines: a.deadlines.map((d) => (d === main ? { ...d, date } : d)) })
  patchApp(a.id, { deadlines: [...a.deadlines, { id: uid('dl'), kind: 'scholarship', date }] })
}

function TableView({ apps, orgName, fields, sort, setSort, tz }: { apps: Application[]; orgName: (id: string | null) => string; fields: FieldDef[]; sort: Sort; setSort: (s: Sort) => void; tz: string }) {
  const nav = useNavigate()
  const visible = fields.filter((f) => !f.hidden).sort((a, b) => a.order - b.order)
  const rows = useMemo(() => {
    const list = apps.slice()
    list.sort((a, b) => {
      const va = cellValue(a, sort.key, orgName, tz), vb = cellValue(b, sort.key, orgName, tz)
      if (!va && vb) return 1
      if (va && !vb) return -1
      return va.localeCompare(vb, undefined, { numeric: true }) * sort.dir
    })
    return list
  }, [apps, sort, tz]) // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (a: Application, f: FieldDef, v: string) => {
    switch (f.key) {
      case 'title': return patchApp(a.id, { title: v })
      case 'institution': return patchApp(a.id, { organisationId: v.trim() ? upsertOrg(v.trim(), 'university') : null })
      case 'funder': return patchApp(a.id, { funder: v.trim() || null })
      case 'deadline': return setMainDeadline(a, v)
      case 'status': return setStatus(a.id, v as Status)
      case 'country': return patchApp(a.id, { country: v })
      case 'programme': return patchApp(a.id, { programme: v })
      case 'funding': return patchApp(a.id, { funding: { ...a.funding, summary: v } })
      default: return patchApp(a.id, { custom: { ...a.custom, [f.key]: v } })
    }
  }
  const inputType = (t: FieldType) => (t === 'date' ? 'date' : t === 'number' || t === 'money' ? 'number' : t === 'url' ? 'url' : 'text')

  return (
    <div className="tablewrap">
      <table className="sheet">
        <thead><tr>
          {visible.map((f, i) => (
            <th key={f.id} className={i === 0 ? 'first' : ''} onClick={() => setSort({ key: f.key, dir: sort.key === f.key ? (sort.dir === 1 ? -1 : 1) : 1 })} aria-sort={sort.key === f.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
              {f.label}{sort.key === f.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
            </th>
          ))}
          <th style={{ cursor: 'default' }} />
        </tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              {visible.map((f, i) => {
                const v = cellValue(a, f.key, orgName, tz)
                return (
                  <td key={f.id} className={i === 0 ? 'first' : ''}>
                    {f.key === 'status' ? (
                      <select aria-label={`Status of ${a.title}`} value={a.status} onChange={(e) => edit(a, f, e.target.value)}>{STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
                    ) : f.type === 'select' && f.options?.length ? (
                      <select aria-label={f.label} value={v} onChange={(e) => edit(a, f, e.target.value)}><option value="" />{f.options.map((o) => <option key={o}>{o}</option>)}</select>
                    ) : (
                      <input aria-label={`${f.label} of ${a.title}`} type={inputType(f.type)} defaultValue={v} key={v} list={f.key === 'institution' ? 'orglist' : undefined} onBlur={(e) => { if (e.target.value !== v) edit(a, f, e.target.value) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                    )}
                  </td>
                )
              })}
              <td><button className="icon-btn" aria-label={`Open ${a.title}`} onClick={() => nav(`/app/${a.id}`)}>→</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <OrgList />
    </div>
  )
}

function OrgList() {
  const { orgs } = useAppState()
  return <datalist id="orglist">{orgs.filter((o) => o.kind === 'university').map((o) => <option key={o.id} value={o.name} />)}</datalist>
}

function BoardView({ apps, orgName, tz }: { apps: Application[]; orgName: (id: string | null) => string; tz: string }) {
  const [over, setOver] = useState<Status | null>(null)
  return (
    <div className="board">
      {STATUSES.map((s) => {
        const list = apps.filter((a) => a.status === s.id).sort((a, b) => (deadlineDays(a, tz) ?? 1e9) - (deadlineDays(b, tz) ?? 1e9))
        return (
          <div key={s.id} className={`col${over === s.id ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(s.id) }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) setStatus(id, s.id) }}>
            <h4><span>{s.label}</span><span>{list.length}</span></h4>
            {list.map((a) => (
              <Link key={a.id} to={`/app/${a.id}`} className="kcard" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', a.id)}>
                <div className="t">{a.title || 'Untitled'}</div>
                <div className="small muted truncate" style={{ margin: '2px 0 7px' }}>{orgName(a.organisationId) || a.funder || a.country}</div>
                <DeadlineChip app={a} tz={tz} />
                <select className="select" style={{ marginTop: 8, padding: '4px 8px', fontSize: 13 }} aria-label={`Move ${a.title}`} value={a.status} onClick={(e) => e.preventDefault()} onChange={(e) => setStatus(a.id, e.target.value as Status)}>{STATUSES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
              </Link>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function ColumnEditor({ fields }: { fields: FieldDef[] }) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const [options, setOptions] = useState('')
  const add = () => {
    const l = label.trim()
    if (!l) return
    const key = l.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || uid('c')
    if (fields.some((f) => f.key === key)) return
    addField({ key, label: l, type, options: type === 'select' ? options.split(',').map((x) => x.trim()).filter(Boolean) : undefined })
    setLabel(''); setOptions('')
  }
  return (
    <div className="stack">
      <div className="stack sm">
        {fields.slice().sort((a, b) => a.order - b.order).map((f) => (
          <div className="row" key={f.id}>
            <label className="check grow"><input type="checkbox" checked={!f.hidden} onChange={(e) => updateField(f.id, { hidden: !e.target.checked })} /><span>{f.label} <span className="muted small">{f.isDefault ? 'built in' : f.type}</span></span></label>
            {!f.isDefault && <button className="icon-btn" aria-label={`Delete ${f.label}`} onClick={() => removeField(f.id)}><Trash2 size={15} /></button>}
          </div>
        ))}
      </div>
      <div className="card flat stack">
        <b>Add a column</b>
        <Field label="Name"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Application fee, Contact person" /></Field>
        <Field label="Type"><select className="select" value={type} onChange={(e) => setType(e.target.value as FieldType)}>{(['text', 'date', 'select', 'url', 'number', 'money'] as FieldType[]).map((t) => <option key={t}>{t}</option>)}</select></Field>
        {type === 'select' && <Field label="Options (comma separated)"><input className="input" value={options} onChange={(e) => setOptions(e.target.value)} /></Field>}
        <button className="btn primary" onClick={add} disabled={!label.trim()}>Add column</button>
        <p className="hint">New links you add are read for these columns too, so a "Referee deadline" column fills itself when the post mentions one.</p>
      </div>
    </div>
  )
}
