import { describe, expect, it } from 'vitest'
import { extractToolMediaPaths, producedForClosing, selectProducedFiles } from '../src/client/produced-files.ts'

describe('extractToolMediaPaths & media produced files', () => {
  it('extracts path from message content with <path> tags', () => {
    const record = {
      kind: 'tool-result',
      message: {
        content: [
          { text: '<path>/Users/x/Desktop/demo.png</path>\n<type>image</type>' },
        ],
      },
    }
    expect(extractToolMediaPaths(record)).toEqual(['/Users/x/Desktop/demo.png'])
  })

  it('extracts file_path from display_file call arguments', () => {
    const record = {
      kind: 'tool-result',
      call: {
        name: 'display_file',
        argsRaw: JSON.stringify({ file_path: 'docs/evidence/demo.png' }),
      },
    }
    expect(extractToolMediaPaths(record)).toEqual(['docs/evidence/demo.png'])
  })

  it('includes displayed media in producedForClosing and selectProducedFiles', () => {
    const nodes = [
      { kind: 'assistant', seq: 1, turn: 1 },
      {
        kind: 'tool-result',
        isError: false,
        message: { content: [{ text: '<path>docs/evidence/demo.png</path>' }] },
      },
      { kind: 'assistant', seq: 2, turn: 1 },
    ]
    expect(producedForClosing(nodes, 2)).toEqual(['docs/evidence/demo.png'])

    const selection = selectProducedFiles({ nodes, seq: 2 })
    expect(selection).toEqual(['docs/evidence/demo.png'])
  })
})
