/**
 * Pure derivation of one turn's produced files from finalized conversation
 * nodes — a structural replica of ui-deliverables' `producedForClosing`
 * (the mutation tools' follow-along `locations`, by render intent: a diff
 * card or a generic edit card; reads/deletes/failures produce nothing).
 * Kept dependency-free so the takeover logic is unit-testable and the
 * replica is easy to diff against upstream when it drifts.
 */
import { isAbsolutePath } from './paths.ts'

/** Paths a tool-result view reports as produced, by render intent. */
export function producedPaths(view: unknown): readonly string[] {
  if (view === null || typeof view !== 'object') return []
  const record = view as { card?: unknown; kind?: unknown; locations?: unknown }
  const isEdit = record.card === 'diff' || (record.card === 'generic' && record.kind === 'edit')
  if (!isEdit) return []
  if (!Array.isArray(record.locations)) return []
  const paths: string[] = []
  for (const location of record.locations) {
    if (location !== null && typeof location === 'object' && typeof (location as { path?: unknown }).path === 'string') {
      paths.push((location as { path: string }).path)
    }
  }
  return paths
}

/**
 * Paths of media a tool result displayed (display_file / read_image).
 *
 * A displayed image or video is a deliverable of the turn even though no
 * mutation tool recorded it: display_file prints a `<path>` tag into its
 * result message, and both tools carry the file in their own call arguments.
 * Both shapes are read structurally — the node payload is unknown-safe, like
 * the rest of this file.
 */
export function extractToolMediaPaths(record: unknown): readonly string[] {
  if (record === null || typeof record !== 'object') return []
  const rec = record as {
    message?: { content?: unknown }
    call?: { name?: unknown; argsRaw?: unknown }
  }
  const paths: string[] = []

  // 1. The `<path>` tag display_file prints into the result message.
  const content = rec.message?.content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue
      const text = (block as { text?: unknown }).text
      if (typeof text !== 'string') continue
      const found = /<path>([\s\S]*?)<\/path>/.exec(text)?.[1]?.trim()
      if (found !== undefined && found !== '') paths.push(found)
    }
  }

  // 2. The call arguments of the media tools themselves.
  const call = rec.call
  if (call !== undefined && call !== null && typeof call === 'object'
    && (call.name === 'display_file' || call.name === 'read_image')
    && typeof call.argsRaw === 'string') {
    try {
      const parsed = JSON.parse(call.argsRaw) as { file_path?: unknown; path?: unknown } | null
      const raw = parsed?.file_path ?? parsed?.path
      if (typeof raw === 'string' && raw.trim() !== '') paths.push(raw.trim())
    } catch {
      // Unparsable call arguments: no media path to report.
    }
  }

  return paths
}

/**
 * Files produced by the turn the assistant at `seq` closes. Accumulation
 * resets on turn boundaries (a user message, or a node reporting a different
 * turn number); paths keep first-seen order and appear once.
 * @param nodes - snapshot nodes in surface order (structural, unknown-safe).
 * @param seq - the closing assistant's seq (the render site's anchor).
 * @returns produced paths; empty when the turn wrote nothing.
 */
export function producedForClosing(nodes: readonly unknown[], seq: number): readonly string[] {
  let pending: string[] = []
  let seen = new Set<string>()
  let turn: number | undefined
  for (const node of nodes) {
    if (node === null || typeof node !== 'object') continue
    const record = node as { kind?: unknown; isError?: unknown; callView?: unknown; turn?: unknown; seq?: unknown }
    if (record.kind === 'tool-result') {
      if (record.isError === true) continue
      for (const path of producedPaths(record.callView)) {
        if (seen.has(path)) continue
        seen.add(path)
        pending.push(path)
      }
      // Media the tool displayed ranks as produced by the same turn.
      for (const path of extractToolMediaPaths(record)) {
        if (seen.has(path)) continue
        seen.add(path)
        pending.push(path)
      }
      continue
    }
    if (record.kind === 'user') {
      turn = undefined
      pending = []
      seen = new Set()
    } else if (typeof record.turn === 'number') {
      if (turn !== undefined && record.turn !== turn) {
        pending = []
        seen = new Set()
      }
      turn = record.turn
    }
    if (record.kind === 'assistant' && record.seq === seq) return pending
  }
  return []
}

/**
 * Claim the turn-tail chain only when the closing turn produced files.
 *
 * The authoritative source is the engine Turn data — the same value
 * ui-deliverables reads (`owner.turn.data.get('deliverables')`): a
 * `{ produced: [{ seq, path }, ...] }` record accumulated per Turn. The
 * node-based replica below stays as a fallback for compositions that do not
 * publish it.
 * @param owner - the turn-tail owner currency ({turn, seq, openFile}).
 * @returns produced paths as the matched value, or null to decline.
 */
export function selectProducedFiles(owner: unknown): readonly string[] | null {
  const record = owner as {
    turn?: { data?: { get?: (key: string) => unknown } }
    nodes?: unknown
    seq?: unknown
  } | null
  if (record === null || typeof record !== 'object') return null
  const seq = typeof record.seq === 'number' ? record.seq : Number.POSITIVE_INFINITY
  const data = record.turn?.data?.get?.('deliverables') as
    | { produced?: unknown }
    | null
    | undefined
  if (data !== null && typeof data === 'object' && Array.isArray(data.produced)) {
    const paths: string[] = []
    const seen = new Set<string>()
    for (const item of data.produced) {
      if (item === null || typeof item !== 'object') continue
      const produced = item as { path?: unknown; seq?: unknown }
      if (typeof produced.path !== 'string' || produced.path === '') continue
      if (typeof produced.seq === 'number' && produced.seq > seq) continue
      if (seen.has(produced.path)) continue
      seen.add(produced.path)
      paths.push(produced.path)
    }
    // Displayed media is produced by the turn too, but the engine's
    // deliverables record only carries mutations — merge the node-derived
    // media paths in so the produced-files row lists them as well.
    if (Array.isArray(record.nodes)) {
      for (const path of producedForClosing(record.nodes, seq)) {
        if (seen.has(path)) continue
        seen.add(path)
        paths.push(path)
      }
    }
    return paths.length === 0 ? null : paths
  }
  if (!Array.isArray(record.nodes)) return null
  const paths = producedForClosing(record.nodes, seq)
  return paths.length === 0 ? null : paths
}

/**
 * Resolve a (possibly relative) path against the session cwd for the sidebar.
 * Absolute detection mirrors the host (see client/paths.isAbsolutePath):
 * POSIX roots, drive letters and UNC shares must not be joined onto the cwd.
 */
export function resolveSidebarPath(cwd: string | undefined, path: string): string {
  if (isAbsolutePath(path)) return path
  const base = cwd ?? ''
  if (base === '') return path
  const separator = base.includes('\\') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/, '')}${separator}${path}`
}
