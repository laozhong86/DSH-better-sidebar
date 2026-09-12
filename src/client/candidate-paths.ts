/**
 * Pure heuristic recognizer for candidate workspace file paths in prose inline code.
 *
 * Used to expand chatFileMentions so that any path-like inline code token
 * (e.g. `docs/evidence/demo.png`, `package.json`, `./src/client/index.tsx`)
 * renders as a clickable button that opens the sidebar instead of staying
 * inert, even when the file was not mutated in the closing turn.
 *
 * The host's own mention vocabulary is deliberately narrow: it comes from the
 * mutation tools' `locations` (ui-deliverables' README: "never from the
 * closing prose") and matches an exact path or a unique basename. This
 * recognizer is the widening the host deferred — so it stays a pure predicate
 * and never opens anything itself.
 */

const KNOWN_EXACT_FILES = new Set([
  'makefile',
  'dockerfile',
  'license',
  'agents.md',
  'claude.md',
  'gemini.md',
  'readme.md',
  '.gitignore',
  '.editorconfig',
  '.npmrc',
  '.prettierrc',
  '.eslintrc',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'gemfile',
  'procfile',
])

const KNOWN_EXTENSIONS = new Set([
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'apng',
  // Video & Audio
  'mp4', 'webm', 'mov', 'm4v', 'ogv', 'mp3', 'wav', 'flac', 'ogg', 'm4a', 'opus', 'aac',
  // Documents & Data
  'md', 'markdown', 'pdf', 'txt', 'csv', 'tsv', 'json', 'jsonc', 'json5',
  'yaml', 'yml', 'toml', 'xml', 'html', 'htm',
  // Code & Styles
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'py', 'sh', 'bash', 'zsh', 'css', 'scss', 'less', 'sql',
  'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'vue', 'svelte',
  // Office
  'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt',
])

const INVALID_CHARS_REGEX = /[<>:"|?*`\n\r\t]/
const CODE_EXPRESSION_REGEX = /(?:=>|==|!=|&&|\|\||;|\{|\}|\(|\))/

/**
 * Determine whether a string value from an inline-code token looks like a file path.
 *
 * Rejects code snippets, operators, URLs, and arbitrary prose while accepting
 * relative paths, paths with directories, and recognizable filenames.
 */
export function isCandidateFilePath(value: string): boolean {
  if (!value) return false
  const trimmed = value.trim()
  const len = trimmed.length
  if (len < 2 || len > 300) return false

  // Disallow newlines, invalid filesystem characters, or common code statement markers
  if (INVALID_CHARS_REGEX.test(trimmed)) return false
  if (CODE_EXPRESSION_REGEX.test(trimmed)) return false

  // Reject web protocols
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('data:')) {
    return false
  }

  // Reject CLI commands or flag strings like `--flag`, `-v`
  if (trimmed.startsWith('-')) {
    return false
  }

  // Feature 1: Exact known standalone filenames (case-insensitive)
  const baseName = lower.split(/[\\/]/).pop() ?? ''
  if (KNOWN_EXACT_FILES.has(baseName)) {
    return true
  }

  // Feature 2: Contains path separators (/ or \)
  const hasSlash = trimmed.includes('/') || trimmed.includes('\\')
  if (hasSlash) {
    // Avoid regex or division like `a / b`
    if (trimmed.includes(' / ') || trimmed.includes(' \\ ')) return false
    // Reject git diff prefixes alone
    if (trimmed === 'a/' || trimmed === 'b/') return false

    // Check if it ends with an extension or has valid path segments
    const dotIndex = trimmed.lastIndexOf('.')
    if (dotIndex > 0 && dotIndex < trimmed.length - 1) {
      const ext = trimmed.slice(dotIndex + 1).toLowerCase()
      if (KNOWN_EXTENSIONS.has(ext)) return true
    }

    // Even without an extension in our known list, a path starting with `./`, `../`, `~/`, or having multiple segments
    if (trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('~/') || trimmed.startsWith('/')) {
      return true
    }

    // E.g. docs/evidence/something or src/client/module
    const segments = trimmed.split(/[\\/]/).filter(Boolean)
    if (segments.length >= 2 && segments.every(s => !s.includes(' '))) {
      return true
    }
  }

  // Feature 3: Single filename without path separator but with a recognized extension
  const dotIndex = trimmed.lastIndexOf('.')
  if (dotIndex > 0 && dotIndex < trimmed.length - 1) {
    const ext = trimmed.slice(dotIndex + 1).toLowerCase()
    if (KNOWN_EXTENSIONS.has(ext)) {
      // Must not contain spaces in standalone filename
      if (!trimmed.includes(' ')) {
        return true
      }
    }
  }

  return false
}

/**
 * Determine whether a path looks like a directory rather than a file.
 *
 * Directories do not have editor content and should be opened in the explorer/file tree
 * rather than an editor tab.
 */
export function isDirectoryPath(path: string): boolean {
  if (!path || typeof path !== 'string') return false
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  if (trimmed === '.' || trimmed === './' || /[\\/]\.$/.test(trimmed)) return true
  if (path.trim().endsWith('/') || path.trim().endsWith('\\')) return true

  const lastSegment = trimmed.split(/[\\/]/).pop() || ''
  const lower = lastSegment.toLowerCase()
  if (KNOWN_EXACT_FILES.has(lower)) return false

  // Leading dot without further extension (e.g. .github, .worktrees, .dsh)
  if (lastSegment.startsWith('.') && !lastSegment.slice(1).includes('.')) {
    return true
  }

  // If the last segment has no dot at all, it is a directory name
  if (!lastSegment.includes('.')) return true

  return false
}
