import { useState } from 'react'
import { ArrowLeft, Bell, LayoutList, Sheet as SheetIcon, ShieldCheck } from 'lucide-react'
import { updateProfile, useAppState } from '../lib/store'
import { AFRICA, COUNTRIES, DEGREES, NATIONALITY, SOURCES } from '../lib/countries'
import { COMMON_TZS, defaultTz } from '../lib/dates'
import { Field } from '../components/ui'

const FIELDS = ['Engineering', 'Computer science', 'Health and medicine', 'Business and economics', 'Law', 'Education', 'Agriculture', 'Social sciences', 'Arts and humanities', 'Natural sciences', 'Public policy']

export function Onboarding() {
  const { profile } = useAppState()
  const [step, setStep] = useState(0)
  const [name, setName] = useState(profile.name)
  const [email, setEmail] = useState(profile.email)
  const [country, setCountry] = useState(profile.country || 'Nigeria')
  const [degree, setDegree] = useState(profile.degreeLevel || 'Masters')
  const [fields, setFields] = useState<string[]>(profile.fields)
  const [sources, setSources] = useState<string[]>(profile.sources)
  const [view, setView] = useState<'list' | 'table'>(profile.view === 'table' ? 'table' : 'list')
  const [tz, setTz] = useState(profile.tz || defaultTz())
  const [notify, setNotify] = useState(false)
  const [emailRem, setEmailRem] = useState(true)
  const [agree, setAgree] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const total = 6
  const toggle = (list: string[], v: string, set: (l: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  async function finish() {
    if (notify && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { await Notification.requestPermission() } catch { /* ignore */ }
    }
    updateProfile({
      name: name.trim().slice(0, 60), email: email.trim(), country, nationality: NATIONALITY[country] ?? '', degreeLevel: degree, fields, sources, view, tz,
      emailReminders: emailRem && !!email.trim(), onboarded: true, consentAt: new Date().toISOString(),
    })
  }

  const next = () => setStep((s) => s + 1)
  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
  const canNext = [!!name.trim() && emailOk, !!country, true, true, true, agree && privacy][step]

  return (
    <div className="onb">
      <div className="row between">
        {step > 0 ? <button className="icon-btn" onClick={() => setStep(step - 1)} aria-label="Back"><ArrowLeft size={18} /></button> : <span />}
        <div className="dots" aria-label={`Step ${step + 1} of ${total}`}>{Array.from({ length: total }, (_, i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
        <span style={{ width: 34 }} />
      </div>

      {step === 0 && (
        <div className="stack lg">
          <div><img src="/icon.svg" alt="" width={44} height={44} style={{ borderRadius: 12 }} /><h1 className="hero" style={{ marginTop: 14 }}>Never miss a scholarship deadline again.</h1>
            <p className="sub" style={{ marginTop: 10 }}>Share or paste any scholarship post. Trackr reads it, files the university, deadline and requirements, and reminds you before it closes.</p></div>
          <Field label="What should we call you?"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" placeholder="First name" /></Field>
          <Field label="Email (optional)" hint="Used only for deadline reminder emails. Your tracker is stored on this device."><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />{!emailOk && <p className="hint" style={{ color: 'var(--bad)' }} role="alert">That email does not look right.</p>}</Field>
        </div>
      )}

      {step === 1 && (
        <div className="stack lg">
          <h1>A little about you</h1>
          <p className="sub">This powers the "am I eligible?" check on every scholarship.</p>
          <Field label="Country"><select className="select" value={country} onChange={(e) => setCountry(e.target.value)}>
            <optgroup label="Africa">{AFRICA.map((c) => <option key={c}>{c}</option>)}</optgroup>
            <optgroup label="Elsewhere">{COUNTRIES.filter((c) => !AFRICA.includes(c)).map((c) => <option key={c}>{c}</option>)}</optgroup>
          </select></Field>
          <Field label="Level you are applying for"><div className="chips">{DEGREES.map((d) => <button key={d} className="chip" aria-pressed={degree === d} onClick={() => setDegree(d)}>{d}</button>)}</div></Field>
          <Field label="Fields of study (pick any)"><div className="chips">{FIELDS.map((f) => <button key={f} className="chip" aria-pressed={fields.includes(f)} onClick={() => toggle(fields, f, setFields)}>{f}</button>)}</div></Field>
          <Field label="Your time zone" hint="Deadlines are converted to this."><select className="select" value={tz} onChange={(e) => setTz(e.target.value)}>{Array.from(new Set([tz, ...COMMON_TZS])).map((z) => <option key={z}>{z}</option>)}</select></Field>
        </div>
      )}

      {step === 2 && (
        <div className="stack lg">
          <h1>Where do you find scholarships?</h1>
          <p className="sub">Pick the places you look. We will show the quickest way to send each one to Trackr.</p>
          <div className="stack sm">{SOURCES.map((s) => (
            <button key={s.id} className="opt" aria-pressed={sources.includes(s.id)} onClick={() => toggle(sources, s.id, setSources)}>
              <span className="grow"><b>{s.label}</b>{sources.includes(s.id) && <span className="small sub" style={{ display: 'block', marginTop: 3 }}>{s.tip}</span>}</span>
            </button>
          ))}</div>
          <div className="banner info"><ShieldCheck size={18} /><div><b>No account linking</b><span>Trackr never connects to your social accounts. You decide what to share.</span></div></div>
        </div>
      )}

      {step === 3 && (
        <div className="stack lg">
          <h1>How do you like to see them?</h1>
          <p className="sub">You can switch any time from the top of your tracker.</p>
          <button className="opt" aria-pressed={view === 'list'} onClick={() => setView('list')}><span className="ic"><LayoutList size={18} /></span><span><b>List of universities</b><span className="small sub" style={{ display: 'block' }}>Tap a university to open every detail of that application.</span></span></button>
          <button className="opt" aria-pressed={view === 'table'} onClick={() => setView('table')}><span className="ic"><SheetIcon size={18} /></span><span><b>Spreadsheet</b><span className="small sub" style={{ display: 'block' }}>Rows and columns with University, Deadline and Status, plus columns you add.</span></span></button>
        </div>
      )}

      {step === 4 && (
        <div className="stack lg">
          <h1>Reminders</h1>
          <p className="sub">Trackr nudges you at 14, 7, 3 and 1 days before each deadline.</p>
          <label className="opt" style={{ cursor: 'pointer' }}><span className="ic"><Bell size={18} /></span><span className="grow"><b>Notifications on this device</b><span className="small sub" style={{ display: 'block' }}>Works best once Trackr is installed to your home screen.</span></span><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--brand)' }} /></label>
          <label className="opt" style={{ cursor: 'pointer' }}><span className="grow"><b>Email reminders</b><span className="small sub" style={{ display: 'block' }}>{email.trim() ? `Sent to ${email.trim()}. Needs the server add-on to be switched on.` : 'Add an email on the first step to use this.'}</span></span><input type="checkbox" disabled={!email.trim()} checked={emailRem && !!email.trim()} onChange={(e) => setEmailRem(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--brand)' }} /></label>
        </div>
      )}

      {step === 5 && (
        <div className="stack lg">
          <h1>One last thing</h1>
          <p className="sub">Plain-language summary: your tracker lives on your device. Links and screenshots you add are sent to an AI service only to read them, and are not used to build ads or sold.</p>
          <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I agree to the <a href="/terms" target="_blank">Terms of Use</a>.</span></label>
          <label className="check"><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} /><span>I have read the <a href="/privacy" target="_blank">Privacy Notice</a> (GDPR and Nigeria NDPA) and consent to my details being processed as described.</span></label>
        </div>
      )}

      <div style={{ marginTop: 'auto' }}>
        {step < total - 1 ? <button className="btn primary lg block" disabled={!canNext} onClick={next}>Continue</button>
          : <button className="btn primary lg block" disabled={!canNext} onClick={finish}>Start tracking</button>}
      </div>
    </div>
  )
}
