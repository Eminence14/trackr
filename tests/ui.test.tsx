// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { describe, it, expect, beforeAll } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../src/App'
import { initStore, importAll, defaultState, getState, addApp, upsertOrg, updateProfile } from '../src/lib/store'
import { newApplication } from '../src/lib/ingest'
import { heuristicParse } from '../src/lib/heuristic'
import { saveParsed } from '../src/lib/ingest'
import { DEFAULT_FIELDS } from '../src/lib/store'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as any).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

async function mount(path: string) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  const errors: unknown[] = []
  const onErr = (e: ErrorEvent) => errors.push(e.error)
  window.addEventListener('error', onErr)
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>) })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  const html = el.innerHTML
  await act(async () => root.unmount())
  window.removeEventListener('error', onErr)
  el.remove()
  return { html, errors }
}

let appId = ''
beforeAll(async () => {
  await initStore()
  const s = defaultState()
  s.profile = { ...s.profile, name: 'Ada', email: 'ada@example.com', country: 'Nigeria', nationality: 'Nigerian', degreeLevel: 'Masters', onboarded: true, tz: 'Africa/Lagos' }
  importAll(JSON.stringify({ app: 'trackr', version: 1, state: s }))
  const r = heuristicParse(`Chevening Scholarship 2027/28 for Nigerian students at any UK university. Fully funded. Applications close on 7 October 2027 at 12:00 BST. Requirements: transcripts, 2 references, personal statement. https://www.chevening.org/scholarship/nigeria/`)
  r.university = 'University of Oxford'
  appId = saveParsed(r, { sourceUrl: 'https://x.com/a/status/1', rawText: '', fields: DEFAULT_FIELDS }).id
  void addApp; void upsertOrg; void newApplication; void getState
})

describe('screens render without errors', () => {
  const routes = ['/trending', '/counsellor', '/', '/week', '/review', '/vault', '/essays', '/referees', '/stats', '/import', '/settings', '/more', '/terms', '/privacy']
  for (const path of routes) {
    it(path, async () => {
      const { html, errors } = await mount(path)
      expect(errors).toEqual([])
      expect(html.length).toBeGreaterThan(200)
    })
  }
  it('list view shows the university and scholarship', async () => {
    const { html } = await mount('/')
    expect(html).toContain('University of Oxford')
    expect(html).toContain('Chevening')
  })
  it('table, board and funder views render', async () => {
    for (const v of ['table', 'board']) {
      updateProfile({ view: v as 'table' | 'board' })
      const { html, errors } = await mount('/')
      expect(errors).toEqual([])
      expect(html).toContain('Chevening')
    }
    updateProfile({ view: 'list', groupBy: 'funder' })
    expect((await mount('/')).html).toContain('Chevening')
  })
  it('detail page renders key sections', async () => {
    const { html, errors } = await mount(`/app/${appId}`)
    expect(errors).toEqual([])
    for (const t of ['Key dates', 'Am I eligible?', 'Checklist', 'Your plan', 'Source']) expect(html).toContain(t)
  })
  it('shows onboarding for a new user', async () => {
    const s = defaultState()
    importAll(JSON.stringify({ app: 'trackr', version: 1, state: s }))
    const { html } = await mount('/')
    expect(html).toContain('Never miss a scholarship deadline')
  })
})
