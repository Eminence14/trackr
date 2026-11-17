import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { parseCSV, guessMapping, IMPORT_KEYS, rowsToApplications, type ImportKey, MAX_IMPORT_ROWS } from '../lib/csv'
import { addApps, getState, useAppState } from '../lib/store'
import { findDuplicate } from '../lib/ingest'
import { toast } from '../components/ui'

export function ImportPage() {
  const nav = useNavigate()
  const { fields } = useAppState()
  const [raw, setRaw] = useState('')
  const rows = useMemo(() => (raw.trim() ? parseCSV(raw) : []), [raw])
  const [map, setMap] = useState<Record<ImportKey, number> | null>(null)
  const headers = rows[0] ?? []
  const m = map ?? (headers.length ? guessMapping(headers) : null)

  async function onFile(f: File | undefined) {
    if (!f) return
    if (/\.xlsx?$/i.test(f.name)) { toast('Export your sheet as CSV first (File, Download, CSV), or copy the cells and paste them here.'); return }
    setRaw(await f.text()); setMap(null)
  }
  function run() {
    if (!m) return
    const apps = rowsToApplications(rows.slice(1), m, fields)
    const fresh: typeof apps = []
    const seen = new Set<string>()
    let skipped = 0
    for (const a of apps) {
      const uni = getState().orgs.find((o) => o.id === a.organisationId)?.name
      const key = `${a.title.toLowerCase()}|${(uni ?? '').toLowerCase()}`
      if (seen.has(key) || findDuplicate(a.sourceUrl, '', a.title, uni)) { skipped++; continue }
      seen.add(key); fresh.push(a)
    }
    addApps(fresh)
    const added = fresh.length
    const over = rows.length - 1 - MAX_IMPORT_ROWS
    toast(`${added} imported${skipped ? `, ${skipped} duplicates skipped` : ''}${over > 0 ? `. Only the first ${MAX_IMPORT_ROWS} rows were read` : ''}`)
    nav('/')
  }

  return (
    <div className="stack lg" style={{ maxWidth: 780 }}>
      <div><h1>Import a spreadsheet</h1><p className="sub">Bring in what you already track. Upload a CSV, or copy cells from Excel or Google Sheets and paste them below.</p></div>
      <label className="drop" style={{ display: 'block' }}><Upload size={18} /> <div className="small">Choose a .csv file</div><input type="file" accept=".csv,text/csv,.tsv,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} /></label>
      <textarea className="textarea" placeholder="...or paste rows here, with the header row first" value={raw} onChange={(e) => { setRaw(e.target.value); setMap(null) }} />
      {m && rows.length > 1 && (
        <section className="card stack">
          <h3>Match your columns</h3>
          <div className="grid2">{IMPORT_KEYS.map(({ key, label }) => (
            <div key={key}><label className="label">{label}</label>
              <select className="select" value={m[key]} onChange={(e) => setMap({ ...m, [key]: Number(e.target.value) })}><option value={-1}>(skip)</option>{headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></div>))}</div>
          <p className="small sub">{rows.length - 1} rows found. Dates like 7/10/2026 are read day first.</p>
          <button className="btn primary" onClick={run} disabled={m.title < 0 && m.institution < 0}>Import {rows.length - 1} rows</button>
        </section>
      )}
    </div>
  )
}
