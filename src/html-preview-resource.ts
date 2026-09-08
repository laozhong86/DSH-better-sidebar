/** Bounded, canonical, request-local filesystem reads; never performs network I/O. */
import { constants } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { createHash } from 'node:crypto'
import { ensureWorkspacePath } from './path-security.ts'
import { SidebarError } from './wire.ts'
import type { PreviewLimits } from './html-preview-types.ts'

export const PREVIEW_MAX_BYTES = 16 * 1024 * 1024
const MIME: Record<string, string> = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
  '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
}
export interface PreviewResource { path: string; mime: string; bytes: Buffer }
export function previewError(code: string, message: string): never {
  throw new SidebarError(`preview-${code}`, message, 400)
}
export function dataUrl(mime: string, bytes: Buffer | string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

/** Each instance belongs to exactly one snapshot and authorizes no runtime reads. */
export class PreviewResourceReader {
  readonly resources = new Map<string, PreviewResource>()
  private readonly stamps = new Map<string, { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }>()
  private total = 0
  private disposed = false
  constructor(private readonly workspace: string, private readonly limits: PreviewLimits, private readonly signal?: AbortSignal) {}

  async read(target: string, root = false): Promise<PreviewResource> {
    if (this.disposed || this.signal?.aborted) previewError('cancelled', 'Preview cancelled')
    if (target.includes('\0')) previewError('path', 'Invalid resource path')
    const path = await ensureWorkspacePath(this.workspace, target, true)
    const cached = this.resources.get(path)
    if (cached) return cached
    const mime = MIME[extname(path).toLowerCase()]
    if (!mime || (root && mime !== 'text/html')) previewError('mime', 'Unsupported preview resource type')
    if (this.resources.size >= 128) previewError('budget', 'Preview exceeds 128 local resources')
    const limit = Math.min(root ? this.limits.readLimit : this.limits.mediaLimit, PREVIEW_MAX_BYTES - this.total)
    const before = await stat(path)
    if (!before.isFile()) previewError('file', 'Preview resource is not a regular file')
    if (before.size > limit) previewError('budget', 'Preview resource exceeds the byte budget')
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) previewError('unstable', 'Preview resource changed while opening')
      if (await ensureWorkspacePath(this.workspace, path, true) !== path) previewError('unstable', 'Preview resource path changed')
      const bytes = Buffer.alloc(Math.min(opened.size, limit) + 1)
      let length = 0
      while (length < bytes.length) {
        if (this.disposed || this.signal?.aborted) previewError('cancelled', 'Preview cancelled')
        const result = await handle.read(bytes, length, bytes.length - length, length)
        if (!result.bytesRead) break
        length += result.bytesRead
      }
      const after = await handle.stat()
      const current = await stat(path)
      if (length > limit) previewError('budget', 'Preview resource exceeds the byte budget')
      if (length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
        || current.ino !== opened.ino || current.dev !== opened.dev || current.mtimeMs !== after.mtimeMs
        || await ensureWorkspacePath(this.workspace, path, true) !== path) previewError('unstable', 'Preview resource changed during reading')
      const resource = { path, mime, bytes: bytes.subarray(0, length) }
      this.total += length
      this.resources.set(path, resource)
      this.stamps.set(path, { dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs })
      return resource
    } finally { await handle.close() }
  }

  async validate(): Promise<void> {
    for (const [path, stamp] of this.stamps) {
      if (this.disposed || this.signal?.aborted) previewError('cancelled', 'Preview cancelled')
      if (await ensureWorkspacePath(this.workspace, path, true) !== path) previewError('unstable', 'Preview path changed during snapshot construction')
      const current = await stat(path)
      if (!current.isFile() || current.dev !== stamp.dev || current.ino !== stamp.ino || current.size !== stamp.size
        || current.mtimeMs !== stamp.mtimeMs || current.ctimeMs !== stamp.ctimeMs) previewError('unstable', 'Preview resource changed during snapshot construction')
    }
  }

  revision(): string {
    const hash = createHash('sha256')
    for (const [path, resource] of [...this.resources].sort(([a], [b]) => a.localeCompare(b))) hash.update(path).update('\0').update(resource.bytes)
    return hash.digest('hex')
  }

  dispose(): void { this.disposed = true }
}
