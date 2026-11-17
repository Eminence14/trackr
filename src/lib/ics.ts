import { zonedToInstant } from './dates'

export interface IcsEvent {
  uid: string
  title: string
  date: string
  time?: string
  tz?: string
  description?: string
  url?: string
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const fold = (line: string) => {
  const out: string[] = []
  let rest = line
  while (rest.length > 73) { out.push(rest.slice(0, 73)); rest = ' ' + rest.slice(73) }
  out.push(rest)
  return out.join('\r\n')
}
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const dateOnly = (iso: string) => iso.replace(/-/g, '')
const nextDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + 1))
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`
}

export function buildICS(events: IcsEvent[], userTz: string, name = 'Trackr deadlines'): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Trackr//Deadlines//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`]
  const now = stamp(Date.now())
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@trackr.app`, `DTSTAMP:${now}`)
    if (e.time) {
      const start = zonedToInstant(e.date, e.time, e.tz || userTz)
      lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(start + 30 * 60000)}`)
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.date)}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`)
    }
    lines.push(`SUMMARY:${esc(e.title)}`)
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`)
    if (e.url) lines.push(`URL:${e.url}`)
    for (const trigger of ['-P1D', '-P3D']) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:${trigger}`, 'END:VALARM')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
