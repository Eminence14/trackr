import type { Application, FieldDef, Status } from './types'
import { findDates, fmtDate } from './dates'
import { newApplication } from './ingest'
import { upsertOrg } from './store'
import { uid } from './ids'
import { safeUrl } from './url'

export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  const first = src.split('\n')[0]
  const count = (re: RegExp) => first.match(re)?.length ?? 0
  const delim = count(/;/g) > count(/,/g) ? ';' : count(/\t/g) > count(/,/g) ? '\t' : ','
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim())) rows.push(row)
  return rows
}

// A leading = + - @ would run as a formula when the file is opened in Excel or Sheets, so it is defused with a quote mark.
const defuse = (v: string) => (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? "'" + v : v)
const q = (raw: string) => { const v = defuse(String(raw ?? '')); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v }
export const toCSV = (rows: string[][]) => rows.map((r) => r.map(q).join(',')).join('\r\n')

export const MAX_IMPORT_ROWS = 2000
export type ImportKey = 'title' | 'institution' | 'funder' | 'deadline' | 'status' | 'country' | 'link' | 'notes'
export const IMPORT_KEYS: { key: ImportKey; label: string }[] = [
  { key: 'title', label: 'Scholarship name' }, { key: 'institution', label: 'University' }, { key: 'funder', label: 'Funder' },
  { key: 'deadline', label: 'Deadline' }, { key: 'status', label: 'Status' }, { key: 'country', label: 'Country' }, { key: 'link', label: 'Link' }, { key: 'notes', label: 'Notes' },
]
const GUESS: Record<ImportKey, RegExp> = {
  title: /(scholarship|programme|program|name|title|award|course)/i,
  institution: /(universit|institution|school|college)/i,
  funder: /(funder|sponsor|provider|organi[sz]ation|body)/i,
  deadline: /(deadline|due|closing|close|last date|date)/i,
  status: /(status|stage|progress|applied)/i,
  country: /(country|location|destination)/i,
  link: /(link|url|website|site|source)/i,
  notes: /(note|comment|remark|detail)/i,
}
export function guessMapping(headers: string[]): Record<ImportKey, number> {
  const out = {} as Record<ImportKey, number>
  const used = new Set<number>()
  for (const { key } of IMPORT_KEYS) {
    out[key] = -1
    const i = headers.findIndex((h, idx) => !used.has(idx) && GUESS[key].test(h))
    if (i >= 0) { out[key] = i; used.add(i) }
  }
  return out
}

export function statusFromText(t: string): Status {
  const s = t.toLowerCase()
  if (/not applied|to do|todo|not yet|pending|saved|bookmark/.test(s)) return 'saved'
  if (/interview|shortlist/.test(s)) return 'interview'
  if (/award|won|accepted|success|offer/.test(s)) return 'awarded'
  if (/reject|declin|unsuccess|failed/.test(s)) return 'rejected'
  if (/withdr/.test(s)) return 'withdrawn'
  if (/miss|expired|late/.test(s)) return 'missed'
  if (/applied|submit|sent|done|complete/.test(s)) return 'submitted'
  if (/prepar|progress|working|draft|ongoing/.test(s)) return 'preparing'
  return 'saved'
}

function parseDateCell(v: string): string | undefined {
  const t = v.trim()
  if (!t) return undefined
  const hit = findDates(t)[0]
  if (hit) return hit.date
  // Excel stores dates as day counts (46300 = 5 Oct 2026); they survive a copy-paste as bare numbers
  if (/^\d{5}$/.test(t) && +t > 36000 && +t < 80000) return new Date(Date.UTC(1899, 11, 30) + +t * 86400000).toISOString().slice(0, 10)
  const ms = Date.parse(t)
  if (!Number.isNaN(ms) && /\d{4}/.test(t)) { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  return undefined
}

export function rowsToApplications(rows: string[][], map: Record<ImportKey, number>, fields: FieldDef[], customMap: Record<string, number> = {}): Application[] {
  const cell = (r: string[], k: ImportKey) => (map[k] >= 0 ? (r[map[k]] ?? '').trim() : '')
  const out: Application[] = []
  for (const r of rows.slice(0, MAX_IMPORT_ROWS)) {
    const title = cell(r, 'title')
    const inst = cell(r, 'institution')
    if (!title && !inst) continue
    const link = cell(r, 'link')
    const date = parseDateCell(cell(r, 'deadline'))
    const status = cell(r, 'status') ? statusFromText(cell(r, 'status')) : 'saved'
    const custom: Record<string, string> = {}
    for (const f of fields.filter((x) => !x.isDefault)) if (customMap[f.key] !== undefined && customMap[f.key] >= 0) custom[f.key] = (r[customMap[f.key]] ?? '').trim()
    out.push(newApplication({
      title: title || inst,
      organisationId: inst ? upsertOrg(inst, 'university') : null,
      funder: cell(r, 'funder') || null,
      country: cell(r, 'country'),
      status,
      deadlines: date ? [{ id: uid('dl'), kind: 'scholarship', date }] : [],
      sourceUrl: safeUrl(link),
      sourceKind: 'import',
      notes: cell(r, 'notes'),
      custom,
      verified: true,
      needsReview: false,
    }))
  }
  return out
}

export function applicationsToCSV(apps: Application[], orgName: (id: string | null) => string, fields: FieldDef[]): string {
  const custom = fields.filter((f) => !f.isDefault)
  const header = ['Scholarship', 'University', 'Funder', 'Country', 'Status', 'Deadline', 'Funding', 'Link', 'Official link', 'Notes', ...custom.map((f) => f.label)]
  const rows = apps.map((a) => {
    const d = a.deadlines.filter((x) => x.kind !== 'opens').sort((x, y) => x.date.localeCompare(y.date))[0]
    return [a.title, orgName(a.organisationId), a.funder ?? '', a.country, a.status, d ? fmtDate(d.date) : '', a.funding.summary ?? a.funding.type ?? '', a.sourceUrl, a.officialUrl, a.notes, ...custom.map((f) => a.custom[f.key] ?? '')]
  })
  return toCSV([header, ...rows])
}
