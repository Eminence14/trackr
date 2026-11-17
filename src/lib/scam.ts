import type { ScamFlag } from './types'
import { hostOf } from './url'

const FREE_HOSTS = /(blogspot|wordpress\.com|wixsite|weebly|medium\.com|sites\.google|netlify\.app|github\.io|000webhost|wordpress)/i

function hasUnnegated(text: string, re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let m: RegExpExecArray | null
  while ((m = g.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase()
    if (!/(no|not|without|free of|zero|never|isn'?t|doesn'?t|don'?t charge)\b[^.\n]{0,25}$/.test(before)) return true
  }
  return false
}

export function detectScamFlags(text: string, sourceUrl: string, officialUrl: string, sourceKind: string): ScamFlag[] {
  const t = text || ''
  if (t.trim().length < 200) return [] // nothing meaningful was read, so there is nothing to judge
  const flags: ScamFlag[] = []
  const add = (id: string, severity: ScamFlag['severity'], msg: string) => flags.push({ id, severity, text: msg })

  if (hasUnnegated(t, /(processing|application|registration|administrative|clearance|verification|delivery|acceptance|booking)\s+fees?\b/i) ||
      hasUnnegated(t, /\bpay(?:ment)?\s+(?:a|the|an)?\s*(?:fee|deposit)\b|\b(?:send|transfer)\s+(?:money|₦|\$|funds)\b|\bpay\s+to\s+(?:apply|secure|receive|get)\b/i)) {
    add('payment', 'high', 'The post asks for a payment. Genuine scholarships do not charge you to be considered.')
  }
  if (/guaranteed\s+(?:scholarship|admission|award|visa|funding)|100%\s+(?:guaranteed|approval|success)|(?:no|without)\s+(?:ielts|toefl|gpa|degree)\s+(?:required|needed)[^.\n]{0,30}(?:guarantee|assured)/i.test(t)) {
    add('guaranteed', 'high', 'It promises a guaranteed outcome, which no real selection process can.')
  }
  if (/(?:whatsapp|dm|message)\s+(?:us|me|this number|now)\s+(?:to apply|on|at)|contact\s+(?:us\s+)?(?:on|via)\s+whatsapp|apply\s+(?:via|through|on)\s+(?:whatsapp|dm|telegram)/i.test(t)) {
    add('personal-channel', 'medium', 'Applications go through a personal WhatsApp number or DMs instead of an official portal.')
  }
  if (/[\w.+-]+@(?:gmail|yahoo|outlook|hotmail|ymail)\.com/i.test(t)) {
    add('free-email', 'medium', 'The contact is a free email address rather than an organisation domain.')
  }
  if (/limited\s+slots?|first\s+come\s+first\s+serve|hurry|last\s+chance|only\s+\d+\s+(?:slots?|spaces?|places?)\s+(?:left|available)/i.test(t)) {
    add('urgency', 'medium', 'It uses pressure wording like "limited slots" to rush you.')
  }
  const host = hostOf(sourceUrl)
  if (host && FREE_HOSTS.test(host)) add('free-host', 'medium', 'The post lives on a free blog host, not the funder or university website.')
  if (!officialUrl && !['official', 'manual', 'import', 'shared'].includes(sourceKind)) {
    add('no-official', 'medium', 'No official funder or university page is linked. Confirm on their own website before you share documents.')
  }
  return flags
}
