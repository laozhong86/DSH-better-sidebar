import { describe, expect, it, vi } from 'vitest'
import { registerFileMentionsInterception, type ChatFileMentions, type TurnTailOwnerProps } from '../src/client/intercept.tsx'
import type { Context } from '../src/context-types.ts'
import type { SidebarStore } from '../src/client/state.ts'

describe('registerFileMentionsInterception', () => {
  it('enhances chatFileMentions in-place without touching ctx.provide or ctx.get', () => {
    const mockMentions: ChatFileMentions = {
      forClosing: (_owner: TurnTailOwnerProps, _sessionId: string) => ({
        resolve: (val: string) => (val === 'produced-file.ts' ? { open: vi.fn(), label: val } : undefined),
      }),
    }

    const mockCtx = {
      get: vi.fn((key: string) => {
        if (key === 'chatFileMentions') return mockMentions
        return undefined
      }),
    } as unknown as Context

    const mockStore = {
      getSuspended: vi.fn(() => false),
      getPrefs: vi.fn(() => ({
        tabsEnabled: { editor: true },
      })),
    } as unknown as SidebarStore

    const dispose = registerFileMentionsInterception(mockCtx, mockStore)

    const openFileMock = vi.fn()
    const owner = { seq: 1, openFile: openFileMock } as TurnTailOwnerProps
    const resolver = mockMentions.forClosing(owner, 'session-1')

    expect(resolver).toBeDefined()

    // 1. Existing produced file resolves via original
    const origMatch = resolver?.resolve('produced-file.ts')
    expect(origMatch).toBeDefined()
    expect(origMatch?.label).toBe('produced-file.ts')

    // 2. Candidate image path resolves via enhanced logic
    const imgMatch = resolver?.resolve('docs/evidence/inspiration-modal-tab-deconstruct.png')
    expect(imgMatch).toBeDefined()
    expect(imgMatch?.label).toBe('docs/evidence/inspiration-modal-tab-deconstruct.png')
    imgMatch?.open()
    expect(openFileMock).toHaveBeenCalledWith('docs/evidence/inspiration-modal-tab-deconstruct.png')

    // 3. Regular code statement stays inert
    const codeMatch = resolver?.resolve('const foo = bar()')
    expect(codeMatch).toBeUndefined()

    dispose()
  })

  it('forwards the host sessionId to the wrapped resolver', () => {
    // 0.1.5 passes the session id as a second argument and the host resolver
    // opens *presented* files with it — dropping it sends `undefined` there,
    // so the wrapper must forward it verbatim.
    const seen: string[] = []
    const mockMentions: ChatFileMentions = {
      forClosing: (_owner: TurnTailOwnerProps, sessionId: string) => {
        seen.push(sessionId)
        return { resolve: () => undefined }
      },
    }
    const mockCtx = {
      get: (key: string) => (key === 'chatFileMentions' ? mockMentions : undefined),
    } as unknown as Context
    const mockStore = {
      getSuspended: () => false,
      getPrefs: () => ({ tabsEnabled: { editor: true } }),
    } as unknown as SidebarStore

    const dispose = registerFileMentionsInterception(mockCtx, mockStore)
    mockMentions.forClosing({ seq: 1, openFile: vi.fn() }, 'session-42')
    expect(seen).toEqual(['session-42'])
    dispose()
  })
})
