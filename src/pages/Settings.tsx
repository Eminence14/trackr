import { Link } from 'react-router-dom'
import { Flame, GraduationCap, BarChart3, BookOpen, ChevronRight, FileLock2, Settings as Cog, Upload, Users } from 'lucide-react'
import { exportAll, importAll, resetAll, updateProfile, useAppState } from '../lib/store'
import { COUNTRIES, DEGREES, NATIONALITY } from '../lib/countries'
import { COMMON_TZS } from '../lib/dates'
import { Field, toast } from '../components/ui'
import { downloadFile } from '../lib/download'
import { useEffect, useState } from 'react'
import { cloudEnabled, cloudUser, deleteCloudData, onCloudChange, requestCode, signOut, syncStatus, verifyCode } from '../lib/cloud'

export function More() {
  const items = [
    { to: '/vault', label: 'Documents', icon: <FileLock2 size={18} /> }, { to: '/essays', label: 'Essay library', icon: <BookOpen size={18} /> },
    { to: '/referees', label: 'Referees', icon: <Users size={18} /> }, { to: '/stats', label: 'Insights', icon: <BarChart3 size={18} /> },
    { to: '/trending', label: 'Trending', icon: <Flame size={18} /> }, { to: '/counsellor', label: 'Counsellor view', icon: <GraduationCap size={18} /> },
    { to: '/import', label: 'Import a spreadsheet', icon: <Upload size={18} /> }, { to: '/settings', label: 'Settings', icon: <Cog size={18} /> },
  ]
  return (
    <div className="stack lg"><h1>More</h1><div className="card pad0">{items.map((i) => <Link key={i.to} className="item" to={i.to}>{i.icon}<span className="grow title">{i.label}</span><ChevronRight size={16} className="muted" /></Link>)}</div></div>
  )
}

export function Settings() {
  const { profile } = useAppState()
  const set = updateProfile
  const toggleDay = (d: number) => set({ remindDays: profile.remindDays.includes(d) ? profile.remindDays.filter((x) => x !== d) : [...profile.remindDays, d].sort((a, b) => b - a) })
  return (
    <div className="stack lg" style={{ maxWidth: 680 }}>
      <h1>Settings</h1>
      <section className="card stack"><h3>Profile</h3>
        <div className="grid2"><Field label="Name"><input className="input" value={profile.name} onChange={(e) => set({ name: e.target.value })} /></Field><Field label="Email"><input className="input" type="email" value={profile.email} onChange={(e) => set({ email: e.target.value.trim(), ...(e.target.value.trim() ? {} : { emailReminders: false }) })} /></Field></div>
        <div className="grid2"><Field label="Country"><select className="select" value={profile.country} onChange={(e) => set({ country: e.target.value, nationality: NATIONALITY[e.target.value] ?? profile.nationality })}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Applying for"><select className="select" value={profile.degreeLevel} onChange={(e) => set({ degreeLevel: e.target.value })}>{DEGREES.map((d) => <option key={d}>{d}</option>)}</select></Field></div>
        <div className="grid2"><Field label="Grade (GPA, optional)" hint="Used for the eligibility check."><input className="input" type="number" step="0.01" value={profile.gpa ?? ''} onChange={(e) => set({ gpa: e.target.value ? Number(e.target.value) : undefined })} /></Field>
          <Field label="Time zone"><select className="select" value={profile.tz} onChange={(e) => set({ tz: e.target.value })}>{Array.from(new Set([profile.tz, ...COMMON_TZS])).map((z) => <option key={z}>{z}</option>)}</select></Field></div>
      </section>
      {cloudEnabled && <Account />}
      <section className="card stack"><h3>Reminders</h3>
        <div className="chips">{[30, 14, 7, 3, 1].map((d) => <button key={d} className="chip" aria-pressed={profile.remindDays.includes(d)} onClick={() => toggleDay(d)}>{d} day{d > 1 ? 's' : ''} before</button>)}</div>
        <label className="check"><input type="checkbox" checked={profile.emailReminders} onChange={(e) => set({ emailReminders: e.target.checked })} /><span>Email reminders to {profile.email || '(add an email above)'} <span className="muted small">(needs the server add-on, see README)</span></span></label>
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={async () => { if (typeof Notification === 'undefined') return toast('This browser does not support notifications'); const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Notifications are on' : 'Notifications are off') }}>Allow notifications on this device</button>
      </section>
      <section className="card stack"><h3>Appearance</h3>
        <div className="chips">{(['system', 'light', 'dark'] as const).map((t) => <button key={t} className="chip" aria-pressed={(profile.theme ?? 'system') === t} onClick={() => set({ theme: t })}>{({ system: 'Auto', light: 'Dawn', dark: 'Night' })[t]}</button>)}</div></section>
      <section className="card stack"><h3>Send things to Trackr faster</h3>
        <p className="small sub"><b>Android:</b> install Trackr from the browser menu (Add to Home screen). It then appears in the share sheet of WhatsApp, LinkedIn, X and your browser.</p>
        <p className="small sub"><b>iPhone and iPad:</b> Safari cannot add web apps to the share sheet. Copy the link or text and paste it into Add, or set up the Shortcut described in the README.</p>
        <p className="small sub"><b>Computer:</b> use the Trackr browser extension (folder <code>extension/</code>) to save the page you are reading.</p></section>
      <section className="card stack"><h3>Your data</h3>
        <p className="small sub">Everything is stored on this device. Export a backup regularly. Files in the document vault are not part of the backup, so keep your originals.</p>
        <div className="row wrap">
          <button className="btn" onClick={() => downloadFile('trackr-backup.json', 'application/json', exportAll())}>Download backup</button>
          <label className="btn">Restore backup<input type="file" accept="application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const txt = await f.text(); if (!confirm('Restoring replaces everything currently in Trackr on this device with the backup. Continue?')) { e.target.value = ''; return } importAll(txt); toast('Backup restored') } catch { toast('That file is not a Trackr backup') } e.target.value = '' }} /></label>
          <button className="btn danger" onClick={async () => { if (confirm('Delete everything stored on this device? This cannot be undone.')) { await resetAll(); location.href = '/' } }}>Delete all my data</button>
        </div></section>
      <p className="small muted"><Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link></p>
    </div>
  )
}

function Account() {
  const { profile } = useAppState()
  const [, tick] = useState(0)
  useEffect(() => onCloudChange(() => tick((n) => n + 1)), [])
  const [email, setEmail] = useState(profile.email)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const user = cloudUser()
  const run = async (f: () => Promise<unknown>, ok?: string) => { setBusy(true); try { await f(); if (ok) toast(ok) } catch (e) { toast(String((e as Error).message ?? e)) } finally { setBusy(false) } }
  return (
    <section className="card stack"><h3>Account and sync <span className="tag">beta</span></h3>
      {user ? <>
        <p className="small sub">Signed in as {user.email}. {syncStatus === 'syncing' ? 'Saving...' : syncStatus === 'error' ? 'Could not sync just now; it will retry on your next change.' : 'Your tracker is backed up and email reminders can reach you.'} Vault files stay on this device.</p>
        <div className="row wrap"><button className="btn" disabled={busy} onClick={() => run(signOut, 'Signed out. Your tracker stays on this device.')}>Sign out</button>
          <button className="btn danger" disabled={busy} onClick={() => { if (confirm('Delete the copy of your tracker stored in your account? The copy on this device stays.')) void run(async () => { if (!(await deleteCloudData())) throw new Error('Could not delete everything. Try again.'); await signOut() }, 'Account copy deleted') }}>Delete account copy</button></div>
      </> : <>
        <p className="small sub">Sign in to keep your tracker on more than one device and to receive reminder emails. We email you a 6-digit code; there is no password.</p>
        <div className="row wrap"><input className="input" style={{ maxWidth: 280 }} type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value.trim())} />
          <button className="btn" disabled={busy || !/^\S+@\S+\.\S{2,}$/.test(email)} onClick={() => run(async () => { await requestCode(email); setSent(true) }, 'Code sent. Check your email.')}>Send code</button></div>
        {sent && <div className="row wrap"><input className="input" style={{ maxWidth: 160 }} inputMode="numeric" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn primary" disabled={busy || code.trim().length < 6} onClick={() => run(() => verifyCode(email, code), 'Signed in')}>Sign in</button></div>}
      </>}
    </section>
  )
}
