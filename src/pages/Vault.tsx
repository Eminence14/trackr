import { useEffect, useRef, useState } from 'react'
import { Download, Lock, LockOpen, Trash2, Upload } from 'lucide-react'
import { useAppState, addVaultMeta, patchVaultMeta, removeVaultMeta } from '../lib/store'
import { createVault, deleteDoc, lockVault, readDoc, storeDoc, unlockVault, vaultExists, vaultUnlocked } from '../lib/vault'
import type { VaultDocMeta } from '../lib/types'
import { Empty, toast } from '../components/ui'
import { downloadFile } from '../lib/download'
import { diffDays, todayIn } from '../lib/dates'
import { uid } from '../lib/ids'

const KINDS: VaultDocMeta['kind'][] = ['cv', 'transcript', 'certificate', 'test', 'passport', 'other']
const label: Record<VaultDocMeta['kind'], string> = { cv: 'CV', transcript: 'Transcript', certificate: 'Certificate', test: 'Test result', passport: 'Passport', other: 'Other' }

export function Vault() {
  const { vault, profile } = useAppState()
  const [exists, setExists] = useState<boolean | null>(null)
  const [unlocked, setUnlocked] = useState(vaultUnlocked())
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [kind, setKind] = useState<VaultDocMeta['kind']>('transcript')
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => { void vaultExists().then(setExists) }, [])
  useEffect(() => {
    if (!unlocked) return
    let t = setTimeout(lock, 10 * 60_000)
    function lock() { lockVault(); setUnlocked(false) }
    const bump = () => { clearTimeout(t); t = setTimeout(lock, 10 * 60_000) }
    window.addEventListener('pointerdown', bump); window.addEventListener('keydown', bump)
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', bump); window.removeEventListener('keydown', bump) }
  }, [unlocked])
  if (exists === null) return <div className="center" style={{ padding: 40 }}><span className="spin" /></div>

  async function submit() {
    setErr(''); setBusy(true)
    try {
      if (!exists) {
        if (pass.length < 8) { setErr('Use at least 8 characters.'); return }
        if (pass !== pass2) { setErr('The two passphrases do not match.'); return }
        await createVault(pass); setExists(true); setUnlocked(true)
      } else if (await unlockVault(pass)) setUnlocked(true)
      else setErr('That passphrase is not right.')
    } finally { setBusy(false); setPass(''); setPass2('') }
  }

  if (!unlocked) {
    return (
      <div className="stack lg" style={{ maxWidth: 460 }}>
        <div><h1>Documents</h1><p className="sub">Keep your CV, transcripts, certificates and test scores in one place, encrypted on this device.</p></div>
        <div className="card stack">
          <h3>{exists ? 'Unlock your vault' : 'Create your vault'}</h3>
          <input className="input" type="password" autoComplete={exists ? 'current-password' : 'new-password'} placeholder="Passphrase" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && exists && submit()} />
          {!exists && <input className="input" type="password" autoComplete="new-password" placeholder="Repeat passphrase" value={pass2} onChange={(e) => setPass2(e.target.value)} />}
          {err && <p className="small" style={{ color: 'var(--bad)' }} role="alert">{err}</p>}
          <button className="btn primary" disabled={busy || !pass} onClick={submit}><Lock size={15} /> {exists ? 'Unlock' : 'Create vault'}</button>
          {!exists && <div className="banner warn"><div><b>There is no passphrase recovery</b><span>Files are encrypted before they are stored. If you forget the passphrase, they cannot be opened by anyone, including us.</span></div></div>}
        </div>
      </div>
    )
  }

  async function add(files: FileList | null) {
    if (!files) return
    for (const f of Array.from(files)) {
      if (f.size > 15 * 1024 * 1024) { toast(`${f.name} is over 15 MB`); continue }
      const id = uid('vd')
      try {
        await storeDoc(id, f)
        addVaultMeta({ id, name: f.name, kind, size: f.size, mime: f.type || 'application/octet-stream', addedAt: new Date().toISOString() })
      } catch { toast('Could not store that file') }
    }
  }
  const today = todayIn(profile.tz)

  return (
    <div className="stack lg">
      <div className="page-head"><div><h1>Documents</h1><p className="sub small">Encrypted on this device. Not uploaded anywhere.</p></div>
        <button className="btn" onClick={() => { lockVault(); setUnlocked(false) }}><LockOpen size={15} /> Lock</button></div>
      <div className="card row wrap">
        <select className="select" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value as VaultDocMeta['kind'])} aria-label="Document type">{KINDS.map((k) => <option key={k} value={k}>{label[k]}</option>)}</select>
        <button className="btn primary" onClick={() => file.current?.click()}><Upload size={15} /> Add files</button>
        <input ref={file} type="file" multiple hidden onChange={(e) => { void add(e.target.files); e.target.value = '' }} />
      </div>
      {vault.length === 0 ? <Empty title="Nothing stored yet" text="Add your transcript, CV and certificates once, then reuse them for every application." /> : (
        <div className="card pad0">{vault.map((d) => {
          const left = d.expiresOn ? diffDays(d.expiresOn, today) : undefined
          return (
            <div className="item" key={d.id}>
              <div className="grow"><div className="title truncate">{d.name}</div><div className="meta">{label[d.kind]} · {(d.size / 1024).toFixed(0)} KB</div>
                <div className="row" style={{ marginTop: 6 }}><label className="small sub">Expires <input className="input" style={{ width: 150, padding: '3px 8px', display: 'inline-block' }} type="date" value={d.expiresOn ?? ''} onChange={(e) => patchVaultMeta(d.id, { expiresOn: e.target.value || undefined })} /></label>
                  {left !== undefined && left <= 60 && <span className={`tag ${left < 0 ? 'bad' : 'warn'}`}>{left < 0 ? 'Expired' : `Expires in ${left} days`}</span>}</div></div>
              <button className="icon-btn" aria-label={`Download ${d.name}`} onClick={async () => { try { downloadFile(d.name, d.mime, await readDoc(d.id, d.mime)) } catch { toast('Could not open that file') } }}><Download size={16} /></button>
              <button className="icon-btn" aria-label={`Delete ${d.name}`} onClick={async () => { if (confirm(`Delete ${d.name}?`)) { await deleteDoc(d.id); removeVaultMeta(d.id) } }}><Trash2 size={16} /></button>
            </div>)
        })}</div>
      )}
    </div>
  )
}
