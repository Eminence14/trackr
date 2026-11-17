import type { SourceKind } from './types'

const URL_RE = /https?:\/\/[^\s<>"'()\[\]{}]+/gi
const TRAILING = /[.,;:!?'")\]]+$/

export function extractUrls(text: string): string[] {
  const found = text.match(URL_RE) ?? []
  return Array.from(new Set(found.map((u) => u.replace(TRAILING, ''))))
}

/** Only http(s) links are ever rendered as links. Blocks javascript:, data: and friends from imports and shared links. */
export function safeUrl(u: unknown): string {
  if (typeof u !== 'string') return ''
  try { const x = new URL(u.trim()); return x.protocol === 'http:' || x.protocol === 'https:' ? x.toString() : '' } catch { return '' }
}

/** What a person types into a link box: add https:// when they left it off, refuse anything that is not a web link. */
export const tidyUrl = (u: string) => { const t = u.trim(); return t ? safeUrl(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : 'https://' + t) : '' }

export function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}

const TRACKING = /^(utm_|fbclid|gclid|igshid|mc_|ref$|ref_|s$|t$|si$|feature$|trk|trackingid|lipi|midtoken|midsig|originalsubdomain)/i

export function canonicalUrl(u: string): string {
  try {
    const url = new URL(u.trim())
    url.hash = ''
    for (const k of Array.from(url.searchParams.keys())) if (TRACKING.test(k)) url.searchParams.delete(k)
    url.hostname = url.hostname.replace(/^www\./, '').replace(/^(mobile|m)\./, '')
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.replace(/\/+$/, '')
    let out = url.toString()
    if (out.endsWith('/') && url.pathname === '/' && !url.search) out = out.slice(0, -1)
    return out
  } catch {
    return u.trim()
  }
}

export function sourceKindOf(u: string): SourceKind {
  const h = hostOf(u)
  if (!h) return 'manual'
  if (/(^|\.)(x\.com|twitter\.com|t\.co)$/.test(h)) return 'x'
  if (/(^|\.)(linkedin\.com|lnkd\.in)$/.test(h)) return 'linkedin'
  if (/(^|\.)(whatsapp\.com|wa\.me)$/.test(h)) return 'whatsapp'
  if (/(^|\.)(t\.me|telegram\.me)$/.test(h)) return 'telegram'
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(h)) return 'facebook'
  if (/(^|\.)(instagram\.com)$/.test(h)) return 'instagram'
  if (isLikelyOfficial(u)) return 'official'
  return 'blog'
}

const OFFICIAL_TLD = /(\.edu(\.[a-z]{2})?|\.ac\.[a-z]{2}|\.gov(\.[a-z]{2})?|\.gob\.[a-z]{2}|\.uni-[a-z-]+\.de|\.europa\.eu)$/
const KNOWN_FUNDERS = ['chevening.org', 'commonwealthscholarships.org', 'cscuk.fcdo.gov.uk', 'daad.de', 'fulbright.org', 'mastercardfdn.org', 'rhodeshouse.ox.ac.uk', 'gatesscholarships.org', 'schwarzmanscholars.org', 'akdn.org', 'studyinjapan.go.jp', 'erasmus-plus.ec.europa.eu', 'scholarships.gov.ng', 'stipendiumhungaricum.hu', 'ukri.org', 'wellcome.org', 'clarendon.ox.ac.uk', 'gsmcareers.org']
export function isLikelyOfficial(u: string): boolean {
  const h = hostOf(u)
  if (!h) return false
  return OFFICIAL_TLD.test(h) || KNOWN_FUNDERS.some((k) => h === k || h.endsWith('.' + k))
}

export const isSocial = (u: string) => ['x', 'linkedin', 'whatsapp', 'telegram', 'facebook', 'instagram'].includes(sourceKindOf(u))
export const SHORTENERS = ['t.co', 'lnkd.in', 'bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 'buff.ly', 'wa.me', 'fb.me', 'is.gd', 'rebrand.ly', 'cutt.ly', 'shorturl.at']
export const isShortener = (u: string) => SHORTENERS.includes(hostOf(u))
