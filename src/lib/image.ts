export interface PreparedImage { mime: string; data: string; thumb: string }

async function draw(file: Blob, max: number, quality: number): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  return canvas.toDataURL('image/jpeg', quality)
}

/** Shrink a screenshot so it uploads fast on mobile data, and keep a tiny thumbnail for the detail page. */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const full = await draw(file, 1600, 0.82)
  const thumb = await draw(file, 420, 0.6)
  return { mime: 'image/jpeg', data: full.split(',')[1], thumb }
}
