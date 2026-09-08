// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { DiffPane } from '../../src/client/changes/DiffPane.tsx'
import { api } from '../../src/client/api.ts'
vi.mock('../../src/client/locales.ts', () => ({ t: (key: string) => key }))
afterEach(() => vi.restoreAllMocks())
it('loads a fresh saved snapshot when selecting a newer operation for the same HTML path', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const load = vi.spyOn(api, 'htmlPreview').mockResolvedValue({ html: '<h1>first</h1>', revision: '1', warnings: [], resourceCount: 1, byteLength: 14 })
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const props = (callId: string) => ({ target: { kind: 'op' as const, path: '/workspace/a.html', op: { callId, kind: 'write' as const, path: '/workspace/a.html', time: 0, running: false, isError: false, content: callId } }, scope: { sessionId: 's1', cwd: '/workspace' }, height: 300, onHeightCommit() {}, onClose() {}, onExpand() {} })
  try {
    await act(async () => root.render(<DiffPane key="op:first" {...props('first')} />))
    const toggle = [...container.querySelectorAll('button')].find(button => button.textContent === 'changesHtmlRender')!
    await act(async () => toggle.click())
    expect(load).toHaveBeenCalledTimes(1)
    load.mockResolvedValue({ html: '<h1>second</h1>', revision: '2', warnings: [], resourceCount: 1, byteLength: 15 })
    // ChangesTab keys the pane by operation callId; its render toggle resets.
    await act(async () => root.render(<DiffPane key="op:second" {...props('second')} />))
    expect(container.querySelector('iframe')).toBeNull()
    const nextToggle = [...container.querySelectorAll('button')].find(button => button.textContent === 'changesHtmlRender')!
    await act(async () => nextToggle.click())
    expect(load).toHaveBeenCalledTimes(2)
    expect(container.querySelector('iframe')?.srcdoc).toContain('second')
  } finally { await act(async () => root.unmount()); container.remove() }
})
