// Document vault. Files are encrypted in the browser with a passphrase (PBKDF2 -> AES-GCM) before they are stored.
// There is no passphrase recovery: that is the trade-off.
import { get, set, del } from 'idb-keyval'

const META = 'vault:meta'
const docKey = (id: string) => `vault:doc:${id}`
const ITER = 250_000
const enc = new TextEncoder()
const CHECK = 'trackr-vault-ok'

interface Meta { salt: number[]; iv: number[]; check: number[] }
let session: CryptoKey | null = null
export const vaultUnlocked = () => session !== null
export const lockVault = () => { session = null }

async function derive(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function vaultExists(): Promise<boolean> {
  return !!(await get<Meta>(META))
}

export async function createVault(pass: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await derive(pass, salt)
  const check = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(CHECK)))
  await set(META, { salt: Array.from(salt), iv: Array.from(iv), check: Array.from(check) } satisfies Meta)
  session = key
}

export async function unlockVault(pass: string): Promise<boolean> {
  const meta = await get<Meta>(META)
  if (!meta) return false
  try {
    const key = await derive(pass, new Uint8Array(meta.salt))
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(meta.iv) }, key, new Uint8Array(meta.check))
    if (new TextDecoder().decode(plain) !== CHECK) return false
    session = key
    return true
  } catch {
    return false
  }
}

export async function storeDoc(id: string, file: Blob): Promise<void> {
  if (!session) throw new Error('Vault is locked')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, session, await file.arrayBuffer())
  await set(docKey(id), { iv, data })
}

export async function readDoc(id: string, mime: string): Promise<Blob> {
  if (!session) throw new Error('Vault is locked')
  const rec = await get<{ iv: Uint8Array; data: ArrayBuffer }>(docKey(id))
  if (!rec) throw new Error('File not found')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv as unknown as BufferSource }, session, rec.data)
  return new Blob([plain], { type: mime })
}

export const deleteDoc = (id: string) => del(docKey(id))
