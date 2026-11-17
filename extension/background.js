importScripts('lib.js')
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'save', title: 'Save to Trackr', contexts: ['page', 'link', 'selection'] })
})
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id === undefined) return
  trackrSend(tab.id, info.linkUrl || info.pageUrl || tab.url, info.selectionText)
})
