// Scheduled daily (see netlify.toml). Sends deadline reminder emails and, on Mondays, the weekly digest.
// NOT YET RUN against a live project: it needs the Supabase tables in supabase/schema.sql and a Resend account.
// Built for volume: one query for everyone due today, emails sent in batches of 100, and a log so nobody is emailed twice.
interface Due { user_id: string; email: string; name: string | null; application_id: string; title: string; due_on: string; days_before: number; url: string | null }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

export default async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, REMINDER_FROM, URL: SITE } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !REMINDER_FROM) return new Response('Reminder email is not configured.', { status: 200 })
  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' }
  const today = new Date().toISOString().slice(0, 10)
  const rpc = async <T,>(name: string): Promise<T[]> => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify({ today }) })
    if (!res.ok) throw new Error(`${name} failed: ${res.status}`)
    return (await res.json()) as T[]
  }
  const sendBatch = (emails: { to: string; subject: string; html: string }[]) =>
    fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(emails.map((e) => ({ from: REMINDER_FROM, ...e }))) })

  // One email per person, listing everything of theirs that hits a reminder day today.
  const due = await rpc<Due>('due_reminders')
  const byUser = new Map<string, Due[]>()
  for (const r of due) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r])
  let sent = 0
  for (const group of chunk([...byUser.values()], 100)) {
    const res = await sendBatch(group.map((items) => {
      const soonest = items.reduce((a, b) => (a.days_before <= b.days_before ? a : b))
      const when = soonest.days_before === 0 ? 'today' : soonest.days_before === 1 ? 'tomorrow' : `in ${soonest.days_before} days`
      const list = items.map((i) => `<li><b>${esc(i.title)}</b>: closes ${esc(i.due_on)} (${i.days_before} day${i.days_before === 1 ? '' : 's'} left)</li>`).join('')
      return { to: items[0].email, subject: items.length === 1 ? `${soonest.title} closes ${when}` : `${items.length} deadlines coming up, the first ${when}`, html: `<p>Hi ${esc(items[0].name || 'there')},</p><ul>${list}</ul><p><a href="${esc(SITE ?? '')}/week">Open Trackr</a></p>` }
    }))
    if (!res.ok) continue // leave them unlogged so tomorrow's run does not skip them silently; today's are retried on the next run
    const log = group.flat().map((r) => ({ user_id: r.user_id, application_id: r.application_id, due_on: r.due_on, days_before: r.days_before }))
    await fetch(`${SUPABASE_URL}/rest/v1/reminder_log`, { method: 'POST', headers: { ...headers, prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify(log) })
    sent += group.length
  }

  let digests = 0
  if (new Date().getUTCDay() === 1) {
    const rows = await rpc<{ user_id: string; email: string; name: string | null; items: { title: string; due_on: string }[] }>('weekly_digest')
    for (const group of chunk(rows, 100)) {
      const res = await sendBatch(group.map((r) => ({ to: r.email, subject: `Your week in Trackr: ${r.items.length} closing soon`, html: `<p>Hi ${esc(r.name || 'there')}, closing in the next 7 days:</p><ul>${r.items.map((i) => `<li>${esc(i.title)}: ${esc(i.due_on)}</li>`).join('')}</ul><p><a href="${esc(SITE ?? '')}/week">Open Trackr</a></p>` })))
      if (res.ok) digests += group.length
    }
  }
  return new Response(`Reminder emails: ${sent}. Digests: ${digests}.`, { status: 200 })
}
