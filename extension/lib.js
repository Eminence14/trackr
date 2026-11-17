// Shared by the popup and the background worker.
function trackrExtract() {
  const sel = String(getSelection() || '').trim()
  let text = sel
  let how = 'selection'
  if (sel.length < 40) {
    how = 'page'
    const host = location.hostname
    let root = null
    if (/x\.com|twitter\.com/.test(host)) root = document.querySelector('article')
    root = root || document.querySelector('main') || document.querySelector('article') || document.body
    text = (root.innerText || '').trim()
    // LinkedIn: stop before the comments so other people's names do not leak into the post text
    const cut = text.search(/\n(Most relevant|Add a comment|Comments?\n)/)
    if (cut > 200) text = text.slice(0, cut)
  }
  // keep any links that are visible in the post (forms, official pages)
  const links = Array.from(new Set(Array.from(document.querySelectorAll('main a[href^="http"], article a[href^="http"]')).map((a) => a.href))).filter((h) => !/linkedin\.com|x\.com|twitter\.com|lnkd\.in\/?$/.test(h)).slice(0, 6)
  return { text: text.slice(0, 7000), links, how, url: location.href, title: document.title }
}

async function trackrOrigin() {
  const { trackrOrigin } = await chrome.storage.sync.get('trackrOrigin')
  return (trackrOrigin || 'https://trackr-eminence14s-projects.vercel.app').replace(/\/$/, '')
}

// Opens Trackr with the page text in the URL fragment (a fragment is never sent to any server).
async function trackrSend(tabId, fallbackUrl, fallbackText) {
  let data = { text: fallbackText || '', links: [], url: fallbackUrl || '', title: '' }
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: trackrExtract })
    if (r && r.result) data = r.result
  } catch (e) { /* page not readable (chrome:// etc.) */ }
  const body = [data.text, data.links.length ? 'Links on the page:\n' + data.links.join('\n') : ''].filter(Boolean).join('\n\n')
  const q = new URLSearchParams({ url: data.url, text: body, title: data.title })
  await chrome.tabs.create({ url: `${await trackrOrigin()}/share#${q}` })
}
