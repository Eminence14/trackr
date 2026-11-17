import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ImagePlus, Link2, Sparkles, X } from 'lucide-react'
import { Sheet, toast } from './ui'
import { closeAdd, useAddRequest } from './addBus'
import { captureOne, queueOffline, splitInput, type CaptureItem } from '../lib/capture'
import { prepareImage } from '../lib/image'

async function sharedImages(count: number): Promise<File[]> {
  const out: File[] = []
  try {
    const cache = await caches.open('trackr-shared')
    for (let i = 0; i < count; i++) {
      const res = await cache.match(`/shared-media/${i}`)
      if (res) out.push(new File([await res.blob()], `shared-${i}.jpg`, { type: res.headers.get('content-type') || 'image/jpeg' }))
    }
    for (let i = 0; i < count; i++) await cache.delete(`/shared-media/${i}`)
  } catch { /* cache unavailable */ }
  return out
}

/** Runs jobs with at most `limit` in flight, reporting each result as it lands. */
async function pool<T>(jobs: (() => Promise<T>)[], limit: number, each: (r: T) => void) {
  let next = 0
  const worker = async () => { while (next < jobs.length) { const j = jobs[next++]; each(await j()) } }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker))
}

export function AddSheet() {
  const req = useAddRequest()
  const nav = useNavigate()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [error, setError] = useState('')
  const [onePost, setOnePost] = useState(true)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!req.open) return
    setText([req.url, req.text].filter(Boolean).join('\n'))
    setFiles([])
    if (req.mediaCount) void sharedImages(req.mediaCount).then(setFiles)
  }, [req.open, req.url, req.text, req.mediaCount])

  const previews = files.map((f) => URL.createObjectURL(f))
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return
    setFiles((f) => [...f, ...Array.from(list).filter((x) => x.type.startsWith('image/'))].slice(0, 6))
  }

  async function run() {
    const items: CaptureItem[] = splitInput(text)
    if (!items.length && !files.length) return
    if (!files.length && items.length === 1 && items[0].kind === 'paste' && (items[0].text ?? '').length < 25) { setError('That is too short to be a scholarship post. Paste the whole message or a link.'); return }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const links = items.filter((i) => i.kind === 'link' && i.url)
      if (links.length && links.length === items.length && !files.length) {
        links.forEach((i) => queueOffline(i.url!))
        closeAdd(); setText('')
        toast(`You are offline. ${links.length === 1 ? 'That link' : 'Those links'} will be read when you are back online.`)
        return
      }
      if (files.length) { setError('Screenshots need a connection to be read. Try again when you are online.'); return }
    }
    setBusy(true)
    setError('')
    let last = ''
    let saved = 0
    let dupes = 0
    let refreshed = 0
    let queued = 0
    let note: string | undefined
    // Read up to three things at once: a batch of five links now takes about as long as two.
    type Outcome = Awaited<ReturnType<typeof captureOne>>
    const tally = (o: Outcome) => {
      if (o.queued) queued++
      if (o.id) { last = o.id; if (o.refreshed) refreshed++; else if (o.duplicate) dupes++; else saved++ }
      note = note ?? o.note
    }
    const prepared = (await Promise.all(files.map((f) => prepareImage(f).catch(() => { note = note ?? 'One image could not be read.'; return null })))).filter((p): p is Awaited<ReturnType<typeof prepareImage>> => !!p)
    const groups = prepared.length > 1 && onePost ? [prepared.slice(0, 6)] : prepared.map((p) => [p])
    const jobs: (() => Promise<Outcome>)[] = [
      ...items.map((it) => () => captureOne(it)),
      ...groups.map((g) => () => captureOne(g.length > 1 ? { kind: 'screenshot', images: g } : { kind: 'screenshot', image: g[0] })),
    ]
    let done = 0
    setProgress(jobs.length > 1 ? `0 of ${jobs.length}` : '')
    await pool(jobs, 3, (o) => { tally(o); done++; if (jobs.length > 1) setProgress(`${done} of ${jobs.length}`) })
    setProgress('')
    setBusy(false)
    if (queued && !saved && !dupes && !refreshed) { closeAdd(); setText(''); toast(note ?? 'Saved for later'); return }
    if (!saved && !dupes && !refreshed) { setError(note ?? 'Nothing could be read from that.'); return }
    closeAdd()
    setText(''); setFiles([])
    setOnePost(true)
    const msg = [saved ? `${saved} saved` : '', refreshed ? `${refreshed} updated with a fresh reading` : '', dupes ? `${dupes} already in your tracker` : ''].filter(Boolean).join(', ') || 'Nothing was saved'
    toast(note ? `${msg}. ${note}` : msg, last ? { label: 'Open', run: () => nav(`/app/${last}`) } : undefined)
    if (saved > 1) nav('/review')
  }

  return (
    <Sheet open={req.open} onClose={() => !busy && closeAdd()} title="Add an opportunity">
      <div className="stack">
        <div
          className={`drop${over ? ' over' : ''}`}
          style={{ padding: 22 }}
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }}
          onPaste={(e) => addFiles(e.clipboardData.files)}
          role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') input.current?.click() }}
        >
          <ImagePlus size={24} /> <div><b>Add screenshots</b></div><div className="small">Best for LinkedIn, WhatsApp and X. Pick several for a long post.</div>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        </div>
        {previews.length > 0 && (
          <div className="stack sm">
            <div className="thumbs" style={{ marginTop: 0 }}>{previews.map((p, i) => (
              <div key={p} style={{ position: 'relative' }}>
                <img src={p} alt={`Screenshot ${i + 1}`} />
                <button className="icon-btn" style={{ position: 'absolute', top: -8, right: -8, width: 22, height: 22, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 99 }} aria-label={`Remove screenshot ${i + 1}`} onClick={() => setFiles((f) => f.filter((_, k) => k !== i))}><X size={12} /></button>
                {files.length > 1 && <div className="row" style={{ justifyContent: 'center', gap: 2 }}>
                  <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label="Move earlier" disabled={i === 0} onClick={() => setFiles((f) => { const c = f.slice(); [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c })}><ArrowLeft size={12} /></button>
                  <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label="Move later" disabled={i === files.length - 1} onClick={() => setFiles((f) => { const c = f.slice(); [c[i + 1], c[i]] = [c[i], c[i + 1]]; return c })}><ArrowRight size={12} /></button>
                </div>}
              </div>))}</div>
            {files.length > 1 && <label className="check small"><input type="checkbox" checked={onePost} onChange={(e) => setOnePost(e.target.checked)} /><span>These screenshots are parts of one post (read them together, in this order)</span></label>}
          </div>
        )}
        <div>
          <label className="label" htmlFor="addtext"><Link2 size={14} style={{ verticalAlign: -2 }} /> Or paste a link or the post text</label>
          <textarea id="addtext" className="textarea" style={{ minHeight: 90 }} placeholder="A link, or the whole message copied from WhatsApp, LinkedIn or X." value={text} onChange={(e) => setText(e.target.value)} />
          <p className="hint">Links from LinkedIn, X and WhatsApp often need a login, so a screenshot is more dependable.</p>
        </div>
        {error && <div className="banner bad" role="alert"><div><b>Couldn't read that</b><span>{error}</span></div></div>}
        <button className="btn primary lg block" disabled={busy || (!text.trim() && !files.length)} onClick={run}>
          {busy ? <><span className="spin" /> Reading{progress ? ` ${progress}` : '...'}</> : <><Sparkles size={16} /> Add to Trackr</>}
        </button>
        <p className="hint center">Anything uncertain goes to your review queue so a wrong date never slips through.</p>
      </div>
    </Sheet>
  )
}
