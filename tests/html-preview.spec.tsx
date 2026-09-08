// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { HtmlPreview } from '../src/client/HtmlPreview.tsx'
import { api } from '../src/client/api.ts'
import { HTML_IFRAME_SANDBOX } from '../src/client/html-preview.ts'
import type { PreviewSnapshot } from '../src/html-preview-types.ts'

vi.mock('../src/client/locales.ts', () => ({ t: (key: string) => key }))
const snapshot = (html: string): PreviewSnapshot => ({ html, revision: html, warnings: [], resourceCount: 1, byteLength: html.length })
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
const scope = { sessionId: 's1', cwd: '/workspace' }
describe('opaque snapshot lifecycle', () => {
  it('creates only sandboxed srcDoc frames and refreshes after generation changes', async () => {
    const load = vi.spyOn(api, 'htmlPreview').mockResolvedValue(snapshot('<h1>saved</h1>'))
    await act(async () => root.render(<HtmlPreview scope={scope} path="/workspace/a.html" />))
    const frame = container.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toBe(HTML_IFRAME_SANDBOX)
    expect(frame.getAttribute('srcdoc')).toBe('<h1>saved</h1>')
    expect(frame.hasAttribute('src')).toBe(false)
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    load.mockResolvedValue(snapshot('<h1>saved again</h1>'))
    await act(async () => root.render(<HtmlPreview scope={scope} path="/workspace/a.html" generation={1} />))
    expect(load).toHaveBeenCalledTimes(2)
    expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain('saved again')
    expect(container.querySelector('iframe')).not.toBe(frame)
  })
  it('aborts old requests and ignores slow responses after changing path', async () => {
    let finish: ((value: PreviewSnapshot) => void) | undefined
    const load = vi.spyOn(api, 'htmlPreview').mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(snapshot('new'))
    await act(async () => root.render(<HtmlPreview scope={scope} path="/workspace/a.html" />))
    const signal = load.mock.calls[0]![2]!
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    await act(async () => root.render(<HtmlPreview scope={scope} path="/workspace/b.html" />))
    expect(signal.aborted).toBe(true)
    await act(async () => finish!(snapshot('old')))
    expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toBe('new')
  })
  it('clears previous frames on loading/error and aborts on unmount', async () => {
    const load = vi.spyOn(api, 'htmlPreview').mockResolvedValue(snapshot('saved'))
    await act(async () => root.render(<HtmlPreview scope={scope} path="/workspace/a.html" />))
    load.mockRejectedValue(new Error('preview-budget: too large'))
    await act(async () => root.render(<HtmlPreview scope={scope} path="/workspace/b.html" />))
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('preview-budget')
    const signal = load.mock.calls[1]![2]!
    await act(async () => root.render(null))
    expect(signal.aborted).toBe(true)
  })
})
