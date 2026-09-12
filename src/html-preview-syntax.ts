import { parse, type Node } from 'acorn'
import { createHash } from 'node:crypto'
import { previewError } from './html-preview-resource.ts'

/** Check the strongest supported SRI algorithm, as browsers do. */
export function verifyIntegrity(metadata: string, bytes: Buffer, reference: string): void {
  const tokens = metadata.split(/[\t\n\f\r ]+/).flatMap(token => {
    const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/_-]+={0,2})(?:\?[^\s]*)?$/.exec(token)
    return match ? [{ algorithm: match[1]!, digest: match[2]!.replaceAll('-', '+').replaceAll('_', '/').replace(/=+$/, '') }] : []
  })
  // Unsupported/invalid metadata does not enforce integrity in the browser.
  if (!tokens.length) return
  const strongest = ['sha512', 'sha384', 'sha256'].find(a => tokens.some(t => t.algorithm === a))!
  const digest = createHash(strongest).update(bytes).digest('base64').replace(/=+$/, '')
  if (!tokens.some(t => t.algorithm === strongest && t.digest === digest)) previewError('integrity', `Local resource integrity mismatch: ${reference.slice(0, 160)}`)
}

/** Tokenize srcset URL/descriptor states without splitting data URL commas. */
export function srcsetCandidates(source: string): Array<{ url: string; descriptors: string }> {
  const result: Array<{ url: string; descriptors: string }> = []
  let position = 0
  const space = (c: string): boolean => /[\t\n\f\r ]/.test(c)
  while (position < source.length) {
    while (position < source.length && (space(source[position]!) || source[position] === ',')) position++
    const start = position
    while (position < source.length && !space(source[position]!)) position++
    let url = source.slice(start, position)
    if (!url) break
    if (url.endsWith(',')) { url = url.replace(/,+$/, ''); result.push({ url, descriptors: '' }); continue }
    const descriptorStart = position
    let parentheses = 0
    while (position < source.length) {
      const c = source[position]!
      if (c === ',' && parentheses === 0) break
      if (c === '(') parentheses++
      if (c === ')' && parentheses > 0) parentheses--
      position++
    }
    const descriptors = source.slice(descriptorStart, position).trim()
    position++
    const parts = descriptors ? descriptors.split(/[\t\n\f\r ]+/) : []
    let width = false; let density = false; let height = false; let valid = true
    for (const part of parts) {
      if (/^\d+w$/.test(part) && Number(part.slice(0, -1)) > 0 && !width && !density) width = true
      else if (/^\d+h$/.test(part) && Number(part.slice(0, -1)) > 0 && !height && !density) height = true
      else if (/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?x$/.test(part) && Number(part.slice(0, -1)) >= 0 && !density && !width && !height) density = true
      else valid = false
    }
    if (height && !width) valid = false
    // Invalid candidates are ignored by the browser and must not trigger file reads.
    if (valid) result.push({ url, descriptors })
  }
  return result
}

type SyntaxNode = Node & { [key: string]: unknown }
/** Inspect only modules containing import.meta; parsing never evaluates source. */
export function validateImportMeta(source: string): void {
  let ast: Node
  try { ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) }
  catch { return previewError('module', 'Cannot parse module containing import.meta') }
  function visit(node: SyntaxNode, ancestors: SyntaxNode[]): void {
    if (node.type === 'MetaProperty') {
      const parent = ancestors.at(-1)
      const property = parent?.property as SyntaxNode | undefined
      const member = parent?.type === 'MemberExpression' && parent.object === node
      const name = member ? (parent.computed ? property?.value : property?.name) : undefined
      if (!member || typeof name !== 'string') previewError('import-meta-escape', 'Aliased or computed import.meta cannot preserve local runtime resolution')
      if (name === 'resolve') previewError('import-meta-resolve', 'Local import.meta.resolve requires a runtime resolver; use a literal import')
      if (name === 'url') {
        const consumer = ancestors.at(-2)
        const callee = consumer?.callee as SyntaxNode | undefined
        const args = consumer?.arguments as SyntaxNode[] | undefined
        const absoluteUrl = consumer?.type === 'NewExpression' && callee?.name === 'URL' && typeof args?.[0]?.value === 'string' && /^[a-z][a-z\d+.-]*:/i.test(args[0].value)
        const consoleCall = consumer?.type === 'CallExpression' && callee?.type === 'MemberExpression' && (callee.object as SyntaxNode)?.name === 'console'
        if (!absoluteUrl && !consoleCall && consumer?.type !== 'UnaryExpression' && consumer?.type !== 'BinaryExpression' && consumer?.type !== 'ExpressionStatement') {
          previewError('import-meta-url', 'Relative URL construction or escaping import.meta.url cannot preserve the local resource base; use a static import/reference')
        }
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) { if (child && typeof child === 'object' && typeof child.type === 'string') visit(child as SyntaxNode, [...ancestors, node]) }
      } else if (value && typeof value === 'object' && 'type' in value && typeof value.type === 'string') visit(value as SyntaxNode, [...ancestors, node])
    }
  }
  visit(ast as SyntaxNode, [])
}
