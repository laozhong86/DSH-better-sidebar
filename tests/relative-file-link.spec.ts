// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { registerLinkInterception, shouldInterceptRelativeFile } from '../src/client/link-intercept.ts'

const SELF = 'http://127.0.0.1:43120'

describe('shouldInterceptRelativeFile', () => {
  it('identifies explicit relative file paths and normalizes them', () => {
    expect(shouldInterceptRelativeFile('./docs/demo.png', `${SELF}/docs/demo.png`, SELF)).toBe('docs/demo.png')
    expect(shouldInterceptRelativeFile('../package.json', `${SELF}/package.json`, SELF)).toBe('../package.json')
  })

  it('identifies candidate file paths without protocol', () => {
    expect(shouldInterceptRelativeFile('src/index.ts', `${SELF}/src/index.ts`, SELF)).toBe('src/index.ts')
    expect(shouldInterceptRelativeFile('README.md', `${SELF}/README.md`, SELF)).toBe('README.md')
  })

  it('identifies same-origin pathname when raw href is resolved', () => {
    expect(shouldInterceptRelativeFile('/docs/evidence/demo.png', `${SELF}/docs/evidence/demo.png`, SELF)).toBe('docs/evidence/demo.png')
  })

  it('ignores hash anchors and ordinary URLs', () => {
    expect(shouldInterceptRelativeFile('#heading-1', `${SELF}/#heading-1`, SELF)).toBeNull()
    expect(shouldInterceptRelativeFile('https://example.com/test.png', 'https://example.com/test.png', SELF)).toBeNull()
  })
})

describe('registerLinkInterception with openFileInSidebar', () => {
  it('intercepts relative file links and calls openFileInSidebar', () => {
    const openedFiles: string[] = []
    const openedUrls: string[] = []

    const dispose = registerLinkInterception({
      takeoverEnabled: () => true,
      openInSidebar: (url) => openedUrls.push(url),
      openFileInSidebar: (path) => openedFiles.push(path),
      selfOrigin: SELF,
    })

    const anchor = document.createElement('a')
    anchor.setAttribute('href', './docs/test.png')
    anchor.href = `${SELF}/docs/test.png`
    document.body.appendChild(anchor)

    anchor.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }))

    expect(openedFiles).toEqual(['docs/test.png'])
    expect(openedUrls).toHaveLength(0)

    anchor.remove()
    dispose()
  })
})
