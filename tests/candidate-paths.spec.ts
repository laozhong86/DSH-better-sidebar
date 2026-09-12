import { describe, expect, it } from 'vitest'
import { isCandidateFilePath } from '../src/client/candidate-paths.ts'

describe('isCandidateFilePath', () => {
  it('identifies relative and nested paths with extensions', () => {
    expect(isCandidateFilePath('docs/evidence/demo.png')).toBe(true)
    expect(isCandidateFilePath('./src/client/index.tsx')).toBe(true)
    expect(isCandidateFilePath('../package.json')).toBe(true)
    expect(isCandidateFilePath('plugins/omnimux/route.js')).toBe(true)
    expect(isCandidateFilePath('tests/helpers/setup.ts')).toBe(true)
  })

  it('identifies standalone known filenames and configs', () => {
    expect(isCandidateFilePath('package.json')).toBe(true)
    expect(isCandidateFilePath('Makefile')).toBe(true)
    expect(isCandidateFilePath('Dockerfile')).toBe(true)
    expect(isCandidateFilePath('.gitignore')).toBe(true)
    expect(isCandidateFilePath('AGENTS.md')).toBe(true)
    expect(isCandidateFilePath('README.md')).toBe(true)
  })

  it('identifies standalone filenames with recognized extensions', () => {
    expect(isCandidateFilePath('screenshot.png')).toBe(true)
    expect(isCandidateFilePath('video.mp4')).toBe(true)
    expect(isCandidateFilePath('document.pdf')).toBe(true)
    expect(isCandidateFilePath('styles.css')).toBe(true)
    expect(isCandidateFilePath('script.py')).toBe(true)
  })

  it('identifies absolute and home directory paths', () => {
    expect(isCandidateFilePath('/Users/x/Desktop/test.png')).toBe(true)
    expect(isCandidateFilePath('~/.dsh/AGENTS.md')).toBe(true)
  })

  it('rejects ordinary code expressions and operators', () => {
    expect(isCandidateFilePath('const a = 1;')).toBe(false)
    expect(isCandidateFilePath('() => foo()')).toBe(false)
    expect(isCandidateFilePath('foo && bar')).toBe(false)
    expect(isCandidateFilePath('a / b')).toBe(false)
    expect(isCandidateFilePath('{ key: value }')).toBe(false)
    expect(isCandidateFilePath('npm install')).toBe(false)
    expect(isCandidateFilePath('git commit -m "msg"')).toBe(false)
  })

  it('rejects web URLs and CLI options', () => {
    expect(isCandidateFilePath('https://example.com/test.png')).toBe(false)
    expect(isCandidateFilePath('http://localhost:3000/api')).toBe(false)
    expect(isCandidateFilePath('--verbose')).toBe(false)
    expect(isCandidateFilePath('-rf')).toBe(false)
  })

  it('rejects blank, short or invalid character strings', () => {
    expect(isCandidateFilePath('')).toBe(false)
    expect(isCandidateFilePath('a')).toBe(false)
    expect(isCandidateFilePath('a\nb.ts')).toBe(false)
    expect(isCandidateFilePath('foo<bar>.ts')).toBe(false)
  })
})
