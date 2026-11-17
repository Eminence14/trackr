// Screenshot thumbnails live beside the tracker, not inside it. The tracker is saved as one record on every change,
// so keeping images out of it keeps saving fast even with hundreds of applications.
import { useEffect, useState } from 'react'
import { get, set, del } from 'idb-keyval'

const key = (appId: string) => `thumb:${appId}`
export const putThumb = (appId: string, dataUrl: string) => set(key(appId), dataUrl).catch(() => undefined)
export const getThumb = (appId: string) => get<string>(key(appId)).catch(() => undefined)
export const delThumb = (appId: string) => del(key(appId)).catch(() => undefined)

export function useThumb(appId: string | undefined, has: boolean | undefined, legacy?: string): string | undefined {
  const [src, setSrc] = useState<string | undefined>(legacy)
  useEffect(() => {
    let live = true
    setSrc(legacy)
    if (appId && has && !legacy) void getThumb(appId).then((v) => { if (live) setSrc(v) })
    return () => { live = false }
  }, [appId, has, legacy])
  return src
}
