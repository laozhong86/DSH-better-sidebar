/** Pure server-side AST serialization of a finite static dependency graph. */
import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5'
import * as css from 'css-tree'
import { init, parse as parseModule } from 'es-module-lexer'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { PreviewResourceReader, PREVIEW_MAX_BYTES, dataUrl, previewError } from './html-preview-resource.ts'
import type { PreviewLimits, PreviewSnapshot } from './html-preview-types.ts'
import { SaxesParser } from 'saxes'
import { srcsetCandidates, validateImportMeta, verifyIntegrity } from './html-preview-syntax.ts'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
function elements(node: Node): Element[] {
  const result: Element[] = []
  const pending: Node[] = [node]
  while (pending.length) {
    const current = pending.pop()!
    if ('tagName' in current) result.push(current)
    if ('content' in current) pending.push(current.content)
    if ('childNodes' in current) for (let index = current.childNodes.length - 1; index >= 0; index--) pending.push(current.childNodes[index]!)
    if (result.length > 100_000) previewError('budget', 'Preview exceeds the HTML node budget')
  }
  return result
}
function attributeName(a: Element['attrs'][number]): string { return a.prefix ? `${a.prefix}:${a.name}` : a.name }
function attr(node: Element, name: string): string | undefined { return node.attrs.find(a => attributeName(a) === name)?.value }
function setAttr(node: Element, name: string, value: string): void {
  const found = node.attrs.find(a => attributeName(a) === name)
  if (found) found.value = value
  else node.attrs.push({ name, value })
}
function text(node: Element): string { return node.childNodes.map(n => 'value' in n ? n.value : '').join('') }
function setText(node: Element, value: string): void { node.childNodes = [{ nodeName: '#text', value, parentNode: node }] }
function remove(node: Element): void {
  if (node.parentNode) node.parentNode.childNodes = node.parentNode.childNodes.filter(n => n !== node)
}

/** No browser DOM, fetch, evaluation, parent bridge, or persistent resource cache. */
export class PreviewDocumentBuilder {
  private readonly completed = new Map<string, string>()
  private readonly active = new Set<string>()
  private imports: Record<string, string | null> = Object.create(null)
  private scopes: Record<string, Record<string, string | null>> = Object.create(null)

  private resolveModule(specifier: string, base: string): string {
    const urlLike = /^(\.{1,2}\/|\/|[a-z][a-z\d+.-]*:)/i.test(specifier)
    const normalized = urlLike ? this.url(specifier, base).href : specifier
    const maps = Object.keys(this.scopes).filter(scope => base === scope || (scope.endsWith('/') && base.startsWith(scope))).sort((a, b) => b.length - a.length).map(scope => this.scopes[scope]!)
    maps.push(this.imports)
    for (const map of maps) {
      const key = Object.keys(map).filter(key => key === normalized || (key.endsWith('/') && normalized.startsWith(key))).sort((a, b) => b.length - a.length)[0]
      if (key === undefined) continue
      const target = map[key]
      if (target === null) previewError('module-specifier', `Import map blocks module: ${specifier.slice(0, 160)}`)
      if (key.endsWith('/')) {
        const resolved = this.url(normalized.slice(key.length), target!).href
        if (!resolved.startsWith(target!)) previewError('import-map-prefix', `Import map prefix escapes its target: ${specifier.slice(0, 160)}`)
        return resolved
      }
      return target!
    }
    if (!urlLike) previewError('module-specifier', `Unresolved bare module: ${specifier.slice(0, 160)}`)
    return normalized
  }
  private serializedBytes = 0
  constructor(private readonly reader: PreviewResourceReader) {}

  private url(specifier: string, base: string): URL {
    try { return new URL(specifier, base) } catch { return previewError('url', `Invalid static reference: ${specifier.slice(0, 160)}`) }
  }

  private async resource(specifier: string, base: string, kind: 'asset' | 'css' | 'module' | 'script', depth: number, integrity?: string): Promise<string> {
    if (specifier.startsWith('#') || specifier === '') return specifier
    const url = this.url(specifier, base)
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'data:' || url.protocol === 'blob:') return url.href
    if (url.protocol !== 'file:') previewError('protocol', `Unsupported resource protocol: ${url.protocol}`)
    if (depth > 16) previewError('depth', 'Preview dependency depth exceeds 16')
    const fragment = url.hash
    url.hash = ''; url.search = ''
    const resource = await this.reader.read(fileURLToPath(url))
    if (integrity) verifyIntegrity(integrity, resource.bytes, specifier)
    if ((kind === 'css' && resource.mime !== 'text/css') || ((kind === 'module' || kind === 'script') && resource.mime !== 'text/javascript')) previewError('mime', `Unexpected type for ${kind} reference`)
    // Nested HTML/SVG documents require their own reference serialization, not an arbitrary file bridge.
    if (resource.mime === 'text/html') previewError('nested-html', `Nested local HTML is unsupported: ${specifier.slice(0, 160)}`)
    const key = `${kind}:${resource.path}`
    if (this.active.has(key)) previewError('cycle', `Cyclic ${kind} dependency: ${specifier.slice(0, 160)}`)
    const cached = this.completed.get(key)
    if (cached) return cached + fragment
    this.active.add(key)
    try {
      const resourceBase = pathToFileURL(resource.path).href
      let content: Buffer | string = resource.bytes
      if (kind === 'css') content = await this.rewriteCss(resource.bytes.toString('utf8'), resourceBase, depth)
      if (kind === 'module') content = await this.rewriteModule(resource.bytes.toString('utf8'), resourceBase, depth)
      if (resource.mime === 'image/svg+xml') content = await this.rewriteSvg(resource.bytes.toString('utf8'), resourceBase, depth)
      const value = dataUrl(resource.mime, content)
      this.serializedBytes += Buffer.byteLength(value)
      if (this.serializedBytes > PREVIEW_MAX_BYTES) previewError('budget', 'Serialized dependency graph exceeds the output budget')
      this.completed.set(key, value)
      return value + fragment
    } finally { this.active.delete(key) }
  }

  private async rewriteSvg(source: string, base: string, depth: number): Promise<string> {
    const parser = new SaxesParser({ xmlns: true })
    const chunks: Array<() => Promise<string>> = []
    const stack: Array<{ base: string; style: boolean }> = []
    const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
    const literal = (value: string): void => { chunks.push(async () => value) }
    parser.on('error', () => previewError('svg', 'Invalid external SVG XML'))
    parser.on('doctype', () => previewError('svg-doctype', 'External SVG DTD/entities are unsupported'))
    parser.on('processinginstruction', value => {
      if (value.target === 'xml-stylesheet') previewError('svg-stylesheet', 'External SVG xml-stylesheet processing instruction is unsupported; use a style element')
      literal(`<?${value.target} ${value.body}?>`)
    })
    parser.on('opentag', node => {
      if (stack.length > 128 || chunks.length > 100_000) previewError('budget', 'SVG exceeds the node/depth budget')
      const parentBase = stack.at(-1)?.base ?? base
      const xmlBase = Object.values(node.attributes).find(a => a.uri === 'http://www.w3.org/XML/1998/namespace' && a.local === 'base')
      const nodeBase = xmlBase ? this.url(xmlBase.value, parentBase).href : parentBase
      if (node.local === 'script' && Object.values(node.attributes).some(a => a.local === 'type' && a.value === 'module')) previewError('svg-module', 'External SVG module scripts require a document module graph; use an HTML module entry')
      stack.push({ base: nodeBase, style: node.local === 'style' })
      chunks.push(async () => {
        const attributes: string[] = []
        const integrity = Object.values(node.attributes).find(a => a.local === 'integrity' && !a.uri)
        let rewrittenIntegrity = integrity?.value
        for (const a of Object.values(node.attributes)) {
          if (a === integrity) continue
          if (a === xmlBase) continue
          let value = a.value
          if (a.local === 'srcset') {
            const candidates: string[] = []
            for (const candidate of srcsetCandidates(value)) candidates.push([await this.resource(candidate.url, nodeBase, 'asset', depth + 1), candidate.descriptors].filter(Boolean).join(' '))
            value = candidates.join(', ')
          } else if (['src', 'poster'].includes(a.local) || (a.local === 'href' && (!a.uri || a.uri === 'http://www.w3.org/1999/xlink') && node.local !== 'a')) {
            const stylesheet = node.local === 'link' && Object.values(node.attributes).some(attribute => attribute.local === 'rel' && attribute.value.split(/\s+/).includes('stylesheet'))
            value = await this.resource(value, nodeBase, node.local === 'script' ? 'script' : stylesheet ? 'css' : 'asset', depth + 1, integrity?.value)
            if (integrity && this.url(a.value, nodeBase).protocol === 'file:' && value.startsWith('data:')) {
              const bytes = Buffer.from(value.slice(value.indexOf(',') + 1).split('#')[0]!, 'base64')
              rewrittenIntegrity = `sha256-${createHash('sha256').update(bytes).digest('base64')}`
            }
          } else if (a.local === 'style') value = await this.rewriteCss(value, nodeBase, depth + 1, true)
          else if (['fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'cursor'].includes(a.local) && /url\s*\(/i.test(value)) {
            const declaration = await this.rewriteCss(`${a.local}:${value}`, nodeBase, depth + 1, true)
            value = declaration.slice(declaration.indexOf(':') + 1)
          }
          attributes.push(`${a.name}="${escape(value)}"`)
        }
        if (rewrittenIntegrity !== undefined) attributes.push(`integrity="${escape(rewrittenIntegrity)}"`)
        return `<${node.name}${attributes.length ? ' ' + attributes.join(' ') : ''}>`
      })
    })
    parser.on('closetag', node => { stack.pop(); literal(`</${node.name}>`) })
    const content = (value: string): void => {
      const context = stack.at(-1)
      chunks.push(async () => escape(context?.style ? await this.rewriteCss(value, context.base, depth + 1) : value))
    }
    parser.on('text', content)
    parser.on('cdata', content)
    parser.on('comment', value => literal(`<!--${value}-->`))
    parser.write(source).close()
    const output: string[] = []
    for (const chunk of chunks) output.push(await chunk())
    return output.join('')
  }

  async rewriteCss(source: string, base: string, depth = 0, declaration = false): Promise<string> {
    const ast = css.parse(source, { context: declaration ? 'declarationList' : 'stylesheet', onParseError: () => previewError('css', 'Unsupported CSS syntax') })
    const tasks: Array<{ node: css.Url | css.StringNode; kind: 'css' | 'asset' }> = []
    css.walk(ast, {
      visit: 'Atrule',
      enter(node) {
        if (node.name.toLowerCase() !== 'import' || !node.prelude || node.prelude.type !== 'AtrulePrelude') return
        const first = node.prelude.children.first
        if (first?.type === 'String' || first?.type === 'Url') tasks.push({ node: first, kind: 'css' })
      },
    })
    css.walk(ast, { visit: 'Url', enter(node) { if (!tasks.some(task => task.node === node)) tasks.push({ node, kind: 'asset' }) } })
    for (const task of tasks) task.node.value = await this.resource(task.node.value, base, task.kind, depth + 1)
    return css.generate(ast)
  }

  async rewriteModule(source: string, base: string, depth = 0): Promise<string> {
    await init
    let imports: ReturnType<typeof parseModule>[0]
    try { [imports] = parseModule(source) } catch { return previewError('module', 'Cannot parse module references') }
    const replacements: Array<{ start: number; end: number; value: string }> = []
    if (imports.some(item => item.d === -2)) validateImportMeta(source)
    for (const item of imports) {
      if (item.d === -2) continue
      if (item.n === undefined) previewError('dynamic-import', 'Non-literal dynamic import is unsupported in a local module')
      const specifier = this.resolveModule(item.n, base)
      const rewritten = await this.resource(specifier, base, 'module', depth + 1)
      replacements.push({ start: item.s, end: item.e, value: item.d >= 0 ? JSON.stringify(rewritten) : rewritten })
    }
    for (const replacement of replacements.reverse()) source = source.slice(0, replacement.start) + replacement.value + source.slice(replacement.end)
    return source
  }

  async build(path: string): Promise<PreviewSnapshot> {
    const root = await this.reader.read(path, true)
    const ast = parse(root.bytes.toString('utf8'))
    const nodes = elements(ast)
    let base = pathToFileURL(root.path).href
    const baseNode = nodes.find(node => node.tagName === 'base' && attr(node, 'href') !== undefined)
    if (baseNode) base = this.url(attr(baseNode, 'href')!, base).href
    const maps = nodes.filter(node => node.tagName === 'script' && attr(node, 'type')?.toLowerCase() === 'importmap')
    if (maps.length > 1) previewError('import-map', 'Multiple import maps are unsupported')
    const normalizeMap = (input: unknown): Record<string, string | null> => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return previewError('import-map', 'Import map mappings must be objects')
      const output: Record<string, string | null> = Object.create(null)
      for (const [key, value] of Object.entries(input)) {
        const normalizedKey = /^(\.{1,2}\/|\/|[a-z][a-z\d+.-]*:)/i.test(key) ? this.url(key, base).href : key
        if (value === null) { output[normalizedKey] = null; continue }
        if (typeof value !== 'string') previewError('import-map', `Unsupported import map entry: ${key}`)
        const target = this.url(value, base).href
        if (key.endsWith('/') && !target.endsWith('/')) previewError('import-map-prefix', `Prefix target must end in /: ${key}`)
        output[normalizedKey] = target
      }
      return output
    }
    for (const node of maps) {
      let map: { imports?: unknown; scopes?: Record<string, unknown>; integrity?: unknown }
      try { map = JSON.parse(text(node)) } catch { return previewError('import-map', 'Invalid import map JSON') }
      if (!map || typeof map !== 'object' || Array.isArray(map)) previewError('import-map', 'Invalid import map')
      if (map.integrity !== undefined) previewError('import-map-integrity', 'Import-map integrity metadata cannot be remapped to serialized module URLs; use script/link integrity')
      this.imports = normalizeMap(map.imports ?? {})
      if (map.scopes !== undefined && (!map.scopes || typeof map.scopes !== 'object' || Array.isArray(map.scopes))) previewError('import-map', 'Import map scopes must be an object')
      for (const [scope, values] of Object.entries(map.scopes ?? {})) this.scopes[this.url(scope, base).href] = normalizeMap(values)
    }
    // Local imports are resolved statically at each original referrer. Only remote
    // mappings remain useful to native remote module graphs in the opaque frame.
    const emittedMap = async (map: Record<string, string | null>, remoteScope = false): Promise<Record<string, string | null>> => {
      const output: Record<string, string | null> = Object.create(null)
      for (const [key, value] of Object.entries(map)) {
        if (key.startsWith('file:')) continue
        if (value === null) { output[key] = null; continue }
        if (value.startsWith('file:')) {
          if (key.endsWith('/')) {
            if (remoteScope) previewError('import-map-prefix', `Remote scope points to a local prefix requiring runtime discovery: ${key}`)
            continue
          }
          output[key] = await this.resource(value, base, 'module', 0)
        } else output[key] = value
      }
      return output
    }
    for (const node of maps) {
      const scopes: Record<string, Record<string, string | null>> = Object.create(null)
      for (const [scope, values] of Object.entries(this.scopes)) {
        if (!scope.startsWith('file:')) scopes[scope] = await emittedMap(values, true)
      }
      setText(node, JSON.stringify({ imports: await emittedMap(this.imports), scopes }).replaceAll('<', '\\u003c'))
    }
    for (const node of nodes) {
      if (node.tagName === 'base') { remove(node); continue }
      if (node.tagName === 'object' || node.tagName === 'embed') { remove(node); continue }
      if (node.tagName === 'style') setText(node, await this.rewriteCss(text(node), base))
      const style = attr(node, 'style')
      if (style !== undefined) setAttr(node, 'style', await this.rewriteCss(style, base, 0, true))
      if (node.namespaceURI === 'http://www.w3.org/2000/svg') {
        for (const a of node.attrs) {
          if (['fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'cursor'].includes(a.name) && /url\s*\(/i.test(a.value)) {
            const declaration = await this.rewriteCss(`${a.name}:${a.value}`, base, 0, true)
            a.value = declaration.slice(declaration.indexOf(':') + 1)
          }
        }
      }
      const type = attr(node, 'type')?.toLowerCase()
      if (node.tagName === 'script' && type === 'module' && attr(node, 'src') === undefined) setText(node, await this.rewriteModule(text(node), base))
      for (const name of ['src', 'poster', 'href', 'xlink:href']) {
        const value = attr(node, name)
        if (value === undefined) continue
        const stylesheet = node.tagName === 'link' && attr(node, 'rel')?.split(/\s+/).includes('stylesheet')
        const modulePreload = node.tagName === 'link' && attr(node, 'rel') === 'modulepreload'
        const assetHref = node.tagName === 'image' || node.tagName === 'use' || node.tagName === 'feImage'
        if ((name === 'href' || name === 'xlink:href') && !stylesheet && !modulePreload && !assetHref) {
          if (node.tagName === 'link' && !value.startsWith('#')) {
            const url = this.url(value, base)
            if (url.protocol === 'file:') setAttr(node, name, await this.resource(value, base, 'asset', 0))
            else setAttr(node, name, url.href)
          }
          continue
        }
        const kind = stylesheet ? 'css' : modulePreload || (node.tagName === 'script' && type === 'module') ? 'module' : node.tagName === 'script' ? 'script' : 'asset'
        const rewritten = await this.resource(value, base, kind, 0, attr(node, 'integrity'))
        setAttr(node, name, rewritten)
        if (rewritten.startsWith('data:') && !value.startsWith('data:') && attr(node, 'integrity')) {
          // SRI was checked against original bytes; transformed bytes need a matching digest.
          const bytes = Buffer.from(rewritten.slice(rewritten.indexOf(',') + 1).split('#')[0]!, 'base64')
          setAttr(node, 'integrity', `sha256-${createHash('sha256').update(bytes).digest('base64')}`)
        }
      }
      const srcset = attr(node, 'srcset')
      if (srcset !== undefined) {
        const output: string[] = []
        for (const candidate of srcsetCandidates(srcset)) {
          output.push([await this.resource(candidate.url, base, 'asset', 0), candidate.descriptors].filter(Boolean).join(' '))
        }
        setAttr(node, 'srcset', output.join(', '))
      }
    }
    const head = nodes.find(node => node.tagName === 'head')!
    const policies = parseFragment('<meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="object-src \'none\'; base-uri \'none\'">').childNodes
    for (const node of policies) node.parentNode = head
    head.childNodes.unshift(...policies)
    await this.reader.validate()
    const html = serialize(ast)
    const byteLength = Buffer.byteLength(html)
    if (byteLength > PREVIEW_MAX_BYTES) previewError('budget', 'Preview exceeds the 16 MiB output budget')
    return { html, revision: this.reader.revision(), warnings: [], resourceCount: this.reader.resources.size, byteLength }
  }
}

export async function buildHtmlPreview(workspace: string, path: string, limits: PreviewLimits, signal?: AbortSignal): Promise<PreviewSnapshot> {
  const reader = new PreviewResourceReader(workspace, limits, signal)
  try { return await new PreviewDocumentBuilder(reader).build(resolve(workspace, path)) }
  finally { reader.dispose() }
}
