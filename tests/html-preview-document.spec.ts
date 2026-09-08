import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { srcsetCandidates } from '../src/html-preview-syntax.ts'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { buildHtmlPreview } from '../src/html-preview-document.ts'

const roots: string[] = []
const limits = { readLimit: 1024 * 1024, mediaLimit: 1024 * 1024 }
async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sidebar-document-')); roots.push(root)
  for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content) }
  return root
}
function attribute(html: string, tag: string, name: string): string {
  function visit(node: DefaultTreeAdapterMap['node']): string | undefined {
    if ('tagName' in node && node.tagName === tag) return node.attrs.find(a => a.name === name)?.value
    if ('childNodes' in node) for (const child of node.childNodes) { const found = visit(child); if (found !== undefined) return found }
    return undefined
  }
  return visit(parse(html)) ?? ''
}
function decode(url: string): string { return Buffer.from(url.slice(url.indexOf(',') + 1).split('#')[0]!, 'base64').toString() }
afterEach(async () => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
describe('static HTML snapshot', () => {
  it('keeps scripts, SVG fragments and remote native behavior without fetching', async () => {
    const fetch = vi.fn(() => { throw new Error('network forbidden in builder') }); vi.stubGlobal('fetch', fetch)
    const root = await fixture({ 'index.html': '<script>window.x=1</script><script src="https://cdn.example/x.js"></script><svg><path fill="url(#grad)"></path><use href="#id"/></svg><img src="https://cdn.example/p.png"><script type="module" src="https://cdn.example/m.js"></script>' })
    const result = await buildHtmlPreview(root, 'index.html', limits)
    expect(result.html).toContain('window.x=1'); expect(result.html).toContain('url(#grad)')
    expect(result.html).toContain('https://cdn.example/m.js'); expect(result.html).toContain('href="#id"')
    expect(result.html).toContain('base-uri'); expect(result.html).not.toContain('connect-src')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('embeds shared CSS, nested imports, font/image URLs with their own bases', async () => {
    const root = await fixture({
      'pages/index.html': '<link rel="stylesheet" href="../shared/a.css"><script defer src="../shared/a.js"></script><img src="../shared/i.svg#mark" srcset="../shared/p.png 1x, ../shared/q.png 2x">',
      'shared/a.css': '@import "nested/b.css" layer(theme) supports(display:grid) screen; body{background:url(p.png)}',
      'shared/nested/b.css': '@font-face{src:url(../f.woff2)}', 'shared/f.woff2': 'font', 'shared/p.png': 'p', 'shared/q.png': 'q',
      'shared/a.js': 'window.test=1', 'shared/i.svg': '<svg><g id="mark"/></svg>',
    })
    const result = await buildHtmlPreview(root, 'pages/index.html', limits)
    const stylesheet = decode(attribute(result.html, 'link', 'href'))
    expect(stylesheet).toContain('layer(theme)'); expect(stylesheet).toContain('supports(display:grid)')
    expect(stylesheet).toContain('data:text/css;base64,'); expect(stylesheet).toContain('data:image/png;base64,')
    expect(result.html).toContain('defer'); expect(attribute(result.html, 'img', 'src')).toMatch(/^data:image\/svg\+xml;base64,.*#mark$/)
    expect(attribute(result.html, 'img', 'srcset')).toContain(' 2x')
    expect(result.resourceCount).toBe(8)
  })
  it('rewrites static exports/imports and literal dynamic import with shared identity', async () => {
    const root = await fixture({ 'index.html': '<script type="module" src="main.mjs"></script>', 'main.mjs': 'import {x} from "./dep.mjs"; export {x} from "./dep.mjs"; import("./dep.mjs");', 'dep.mjs': 'export const x=1' })
    const result = await buildHtmlPreview(root, 'index.html', limits)
    const module = decode(attribute(result.html, 'script', 'src'))
    expect(module).not.toContain('./dep.mjs'); expect(module.match(/data:text\/javascript;base64,/g)).toHaveLength(3)
    expect(result.resourceCount).toBe(3)
  })
  it('preserves remote import maps and supports exact local mappings', async () => {
    const root = await fixture({ 'index.html': '<script type="importmap">{"imports":{"dep":"./dep.mjs","remote":"https://cdn.example/m.js"}}</script><script type="module">import "dep"; import "remote"</script>', 'dep.mjs': 'export const x=1' })
    const result = await buildHtmlPreview(root, 'index.html', limits)
    expect(result.html).toContain('https://cdn.example/m.js'); expect(result.html).toContain('data:text/javascript;base64,')
    expect(result.html).not.toContain('import "dep"')
  })
  it.each([
    ['cycle', { 'index.html': '<script type="module" src="a.mjs"></script>', 'a.mjs': 'import "./a.mjs"' }, 'preview-cycle'],
    ['dynamic', { 'index.html': '<script type="module">import(window.path)</script>' }, 'preview-dynamic-import'],
    ['meta', { 'index.html': '<script type="module">new URL("./p.png", import.meta.url)</script>' }, 'preview-import-meta-url'],
    ['css cycle', { 'index.html': '<link rel="stylesheet" href="a.css">', 'a.css': '@import "a.css";' }, 'preview-cycle'],
    ['unknown resource', { 'index.html': '<img src="secret.json">', 'secret.json': '{}' }, 'preview-mime'],
    ['integrity', { 'index.html': '<script src="a.js" integrity="sha256-bad"></script>', 'a.js': '1' }, 'preview-integrity'],
  ] as const)('diagnoses %s rather than silently dropping scripts', async (_name, files, code) => {
    const root = await fixture(files)
    await expect(buildHtmlPreview(root, 'index.html', limits)).rejects.toMatchObject({ code })
  })
  it('normalizes remote scopes and resolves longest local scopes and prefixes', async () => {
    const root = await fixture({
      'index.html': '<script type="importmap">{"imports":{"dep":"https://cdn.example/default.js","pkg/":"./lib/"},"scopes":{"./lib/":{"dep":"./shared.mjs"},"https://cdn.example/app/":{"dep":"https://cdn.example/scoped.js"}}}</script><script type="module" src="lib/main.mjs"></script>',
      'lib/main.mjs': 'import "dep"; import("pkg/child.mjs")', 'lib/child.mjs': 'export const child=1', 'shared.mjs': 'export const scoped=1',
    })
    const result = await buildHtmlPreview(root, 'index.html', limits)
    expect(result.html).toContain('https://cdn.example/app/')
    expect(result.html).toContain('https://cdn.example/scoped.js')
    expect(result.html).not.toContain('file:')
    expect(result.resourceCount).toBe(4)
  })
  it.each(['console.log(import.meta.url)', 'console.log(import.meta.env)', 'if (import.meta.hot) import.meta.hot.accept()', 'console.log(import.meta["url"])'])('retains harmless metadata: %s', async source => {
    const root = await fixture({ 'index.html': `<script type="module">${source}</script>` })
    expect((await buildHtmlPreview(root, 'index.html', limits)).html).toContain(source)
  })
  it.each([
    ['const meta = import.meta', 'preview-import-meta-escape'],
    ['import.meta.resolve("./a.mjs")', 'preview-import-meta-resolve'],
    ['const url = import.meta.url', 'preview-import-meta-url'],
  ])('diagnoses metadata escape/resolution: %s', async (source, code) => {
    const root = await fixture({ 'index.html': `<script type="module">${source}</script>` })
    await expect(buildHtmlPreview(root, 'index.html', limits)).rejects.toMatchObject({ code })
  })
  it('recursively embeds XML SVG styles, presentation URLs, xml:base and namespaced xlink', async () => {
    const root = await fixture({
      'index.html': '<svg><use xlink:href="icons/a.svg#mark"/></svg><img src="icons/a.svg#mark">',
      'icons/a.svg': '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><style><![CDATA[path{fill:url(../b.svg#g)}]]></style><g id="mark" xml:base="../"><image xlink:href="p.png"/><path fill="url(b.svg#g)"/><use href="#local"/></g></svg>',
      'b.svg': '<svg xmlns="http://www.w3.org/2000/svg"><g id="g"/></svg>', 'p.png': 'pixels',
    })
    const result = await buildHtmlPreview(root, 'index.html', limits)
    const svg = decode(attribute(result.html, 'img', 'src'))
    expect(svg).toContain('xlink:href="data:image/png;base64,')
    expect(svg).toContain('data:image/svg+xml;base64,')
    expect(svg).toContain('#g'); expect(svg).toContain('href="#local"'); expect(svg).not.toContain('xml:base')
    expect(result.html).toContain('xlink:href="data:image/svg+xml;base64,')
    expect(result.resourceCount).toBe(4)
  })
  it('rejects external SVG escapes through its own static dependencies', async () => {
    const root = await fixture({ 'index.html': '<img src="a.svg">', 'a.svg': '<svg><image href="../outside.png"/></svg>' })
    await expect(buildHtmlPreview(root, 'index.html', limits)).rejects.toBeDefined()
  })
  it('tokenizes srcset trailing commas, data URLs, exponents and invalid candidates', () => {
    expect(srcsetCandidates('a.png, b.png 2x, data:image/png;base64,AA== 3x, missing.png 1x 2x, wide.png 100w 50h')).toEqual([
      { url: 'a.png', descriptors: '' }, { url: 'b.png', descriptors: '2x' }, { url: 'data:image/png;base64,AA==', descriptors: '3x' }, { url: 'wide.png', descriptors: '100w 50h' },
    ])
    expect(srcsetCandidates('bad.png calc(1, 2), ok.png 1e2x')).toEqual([{ url: 'ok.png', descriptors: '1e2x' }])
  })
  it('does not read invalid srcset candidates', async () => {
    const root = await fixture({ 'index.html': '<img srcset="missing.png 1x 2x, p.png, q.png 2x">', 'p.png': 'p', 'q.png': 'q' })
    const result = await buildHtmlPreview(root, 'index.html', limits)
    expect(result.resourceCount).toBe(3); expect(result.html).not.toContain('missing.png')
  })
  it.each(['css', 'module'] as const)('verifies strongest SRI then hashes transformed %s bytes', async kind => {
    const source = kind === 'css' ? 'body{background:url(p.png)}' : 'import "./dep.mjs"'
    const hash = (algorithm: string, value: string): string => `${algorithm}-${createHash(algorithm).update(value).digest('base64')}`
    const metadata = `${hash('sha256', 'wrong')} ${hash('sha512', source)}?option`
    const root = await fixture({
      'index.html': kind === 'css' ? `<link rel="stylesheet" href="a.css" integrity="${metadata}">` : `<script type="module" src="a.mjs" integrity="${metadata}"></script>`,
      'a.css': source, 'a.mjs': source, 'p.png': 'p', 'dep.mjs': 'export const x=1',
    })
    const result = await buildHtmlPreview(root, 'index.html', limits)
    const tag = kind === 'css' ? 'link' : 'script'
    const rewritten = decode(attribute(result.html, tag, kind === 'css' ? 'href' : 'src'))
    expect(rewritten).not.toBe(source)
    expect(attribute(result.html, tag, 'integrity')).toBe(hash('sha256', rewritten))
    await writeFile(join(root, 'index.html'), `<script src="a.mjs" integrity="${hash('sha256', source)} ${hash('sha512', 'wrong')}"></script>`)
    await expect(buildHtmlPreview(root, 'index.html', limits)).rejects.toMatchObject({ code: 'preview-integrity' })
  })
  it('checks SVG script SRI and diagnoses only unsupported XML constructs', async () => {
    const digest = createHash('sha384').update('window.x=1').digest('base64')
    const root = await fixture({ 'index.html': '<img src="a.svg">', 'a.svg': `<svg><script href="a.js" integrity="sha384-${digest}"/></svg>`, 'a.js': 'window.x=1' })
    const svg = decode(attribute((await buildHtmlPreview(root, 'index.html', limits)).html, 'img', 'src'))
    expect(svg).toContain('integrity="sha256-')
    await writeFile(join(root, 'a.js'), 'changed')
    await expect(buildHtmlPreview(root, 'index.html', limits)).rejects.toMatchObject({ code: 'preview-integrity' })
    await writeFile(join(root, 'a.svg'), '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')
    await expect(buildHtmlPreview(root, 'index.html', limits)).rejects.toMatchObject({ code: 'preview-svg-doctype' })
  })
  it('preserves remote integrity metadata without fetching', async () => {
    const root = await fixture({ 'index.html': '<script src="https://cdn.example/a.js" integrity="sha512-original?option" crossorigin="anonymous"></script>' })
    expect(attribute((await buildHtmlPreview(root, 'index.html', limits)).html, 'script', 'integrity')).toBe('sha512-original?option')
  })
  it('resolves a base before removing it and changes revision after a saved dependency changes', async () => {
    const root = await fixture({ 'index.html': '<base href="shared/"><script src="a.js"></script>', 'shared/a.js': '1' })
    const first = await buildHtmlPreview(root, 'index.html', limits)
    expect(first.html).not.toContain('<base'); expect(decode(attribute(first.html, 'script', 'src'))).toBe('1')
    await writeFile(join(root, 'shared/a.js'), '2')
    expect((await buildHtmlPreview(root, 'index.html', limits)).revision).not.toBe(first.revision)
  })
})
