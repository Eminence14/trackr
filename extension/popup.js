chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (tab && tab.title) document.getElementById('t').textContent = tab.title.slice(0, 80)
  document.getElementById('go').onclick = async () => {
    if (tab && tab.id !== undefined) await trackrSend(tab.id, tab.url)
    window.close()
  }
})
