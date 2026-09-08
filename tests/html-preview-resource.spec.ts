import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PreviewResourceReader } from '../src/html-preview-resource.ts'

const roots: string[] = []
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sidebar-preview-'))
  roots.push(root)
  return root
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
describe('preview resource authorization', () => {
  it('reads canonical workspace resources once and produces content revisions', async () => {
    const root = await fixture()
    await writeFile(join(root, 'a.css'), 'body{}')
    const reader = new PreviewResourceReader(root, { readLimit: 100, mediaLimit: 100 })
    expect((await reader.read(join(root, 'a.css'))).mime).toBe('text/css')
    const revision = reader.revision()
    await reader.read(join(root, 'a.css'))
    expect(reader.resources.size).toBe(1)
    expect(reader.revision()).toBe(revision)
    reader.dispose()
    await expect(reader.read(join(root, 'a.css'))).rejects.toMatchObject({ code: 'preview-cancelled' })
  })
  it('rejects symlink and direct workspace escape', async () => {
    const root = await fixture(); const outside = await fixture()
    await writeFile(join(outside, 'x.js'), 'secret')
    await symlink(join(outside, 'x.js'), join(root, 'x.js'))
    const reader = new PreviewResourceReader(root, { readLimit: 100, mediaLimit: 100 })
    for (const path of [join(root, 'x.js'), join(outside, 'x.js')]) await expect(reader.read(path)).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('rejects unknown MIME, NUL, directories and over-budget resources', async () => {
    const root = await fixture()
    await writeFile(join(root, '.env'), 'secret')
    await writeFile(join(root, 'a.js'), '12345')
    await mkdir(join(root, 'dir.css'))
    const reader = new PreviewResourceReader(root, { readLimit: 2, mediaLimit: 4 })
    await expect(reader.read(join(root, '.env'))).rejects.toMatchObject({ code: 'preview-mime' })
    await expect(reader.read(join(root, 'a.js'))).rejects.toMatchObject({ code: 'preview-budget' })
    await expect(reader.read(join(root, 'dir.css'))).rejects.toMatchObject({ code: 'preview-file' })
    await expect(reader.read('x\0.js')).rejects.toMatchObject({ code: 'preview-path' })
  })
  it('detects replacement after a resource was read', async () => {
    const root = await fixture(); const path = join(root, 'a.js')
    await writeFile(path, 'first')
    const reader = new PreviewResourceReader(root, { readLimit: 100, mediaLimit: 100 })
    await reader.read(path)
    await writeFile(path, 'second version')
    await expect(reader.validate()).rejects.toMatchObject({ code: 'preview-unstable' })
  })
  it('enforces the unique resource budget', async () => {
    const root = await fixture()
    const reader = new PreviewResourceReader(root, { readLimit: 100, mediaLimit: 100 })
    for (let index = 0; index < 129; index++) {
      const path = join(root, `${index}.js`); await writeFile(path, '')
      if (index < 128) await reader.read(path)
      else await expect(reader.read(path)).rejects.toMatchObject({ code: 'preview-budget' })
    }
  })
  it('rejects already cancelled requests before reading', async () => {
    const root = await fixture(); const abort = new AbortController(); abort.abort()
    const reader = new PreviewResourceReader(root, { readLimit: 100, mediaLimit: 100 }, abort.signal)
    await expect(reader.read(join(root, 'a.js'))).rejects.toMatchObject({ code: 'preview-cancelled' })
  })
})
