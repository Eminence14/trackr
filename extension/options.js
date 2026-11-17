const o = document.getElementById('o')
chrome.storage.sync.get('trackrOrigin').then((v) => { o.value = v.trackrOrigin || '' })
document.getElementById('s').onclick = async () => { await chrome.storage.sync.set({ trackrOrigin: o.value.trim() }); document.getElementById('m').textContent = 'Saved' }
