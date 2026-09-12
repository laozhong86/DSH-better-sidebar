import { describe, expect, it } from 'vitest'
import { builtinViewers } from '../src/client/builtins/viewers.tsx'
import { mediaTypeForPath, parseByteRange } from '../src/index.ts'

describe('video & audio viewer support', () => {
  const viewers = builtinViewers()
  const videoViewer = viewers.find(v => v.id === 'video')
  const audioViewer = viewers.find(v => v.id === 'audio')

  it('registers a video viewer behind the range-streamed media route', () => {
    expect(videoViewer).toBeDefined()
    expect(videoViewer?.fetchStrategy).toBe('mediaUrl')
    expect(videoViewer?.exts).toEqual(expect.arrayContaining(['mp4', 'webm', 'mov', 'm4v', 'ogv']))
  })

  it('registers an audio viewer behind the range-streamed media route', () => {
    expect(audioViewer).toBeDefined()
    expect(audioViewer?.fetchStrategy).toBe('mediaUrl')
    expect(audioViewer?.exts).toEqual(expect.arrayContaining(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'opus', 'aac']))
  })

  it('still matches the pre-existing viewers by extension', () => {
    // The two new descriptors are appended after `image`; the catch-all and
    // the binary probe must keep their relative order for matching to hold.
    const image = viewers.find(v => v.id === 'image')
    const code = viewers.find(v => v.id === 'code')
    expect(image?.exts).toContain('png')
    expect(code?.priority).toBe(-100)
  })

  it('resolves the media content types', () => {
    expect(mediaTypeForPath('sample.mp4')).toBe('video/mp4')
    expect(mediaTypeForPath('video.webm')).toBe('video/webm')
    expect(mediaTypeForPath('movie.mov')).toBe('video/quicktime')
    expect(mediaTypeForPath('audio.mp3')).toBe('audio/mpeg')
    expect(mediaTypeForPath('track.wav')).toBe('audio/wav')
    expect(mediaTypeForPath('song.flac')).toBe('audio/flac')
    // Unknown extensions keep the binary-safe fallback.
    expect(mediaTypeForPath('archive.bin')).toBe('application/octet-stream')
  })
})

describe('media range requests', () => {
  const size = 1000

  it('parses an explicit window', () => {
    expect(parseByteRange('bytes=0-99', size)).toEqual({ start: 0, end: 99 })
    expect(parseByteRange('bytes=500-999', size)).toEqual({ start: 500, end: 999 })
  })

  it('parses the open-ended and suffix forms', () => {
    // `start-` runs to the last byte.
    expect(parseByteRange('bytes=500-', size)).toEqual({ start: 500, end: 999 })
    // `-N` is the final N bytes.
    expect(parseByteRange('bytes=-200', size)).toEqual({ start: 800, end: 999 })
    // A suffix longer than the file clamps to the whole body.
    expect(parseByteRange('bytes=-5000', size)).toEqual({ start: 0, end: 999 })
  })

  it('clamps an end past the last byte', () => {
    expect(parseByteRange('bytes=900-100000', size)).toEqual({ start: 900, end: 999 })
  })

  it('rejects malformed, multi-range and unsatisfiable headers', () => {
    // Multi-range falls back to the full body, as does a non-bytes unit.
    expect(parseByteRange('bytes=0-99,200-299', size)).toBeNull()
    expect(parseByteRange('items=0-99', size)).toBeNull()
    expect(parseByteRange('bytes=', size)).toBeNull()
    expect(parseByteRange('bytes=-0', size)).toBeNull()
    // A start at or past EOF is unsatisfiable.
    expect(parseByteRange('bytes=1000-', size)).toBeNull()
    expect(parseByteRange('bytes=1500-1600', size)).toBeNull()
    // Reversed windows are rejected rather than served backwards.
    expect(parseByteRange('bytes=300-200', size)).toBeNull()
  })
})
