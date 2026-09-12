import { isCandidateFilePath } from './candidate-paths.ts'

/**
 * Chat/GUI external-link interception: clicking an http(s) link that points
 * OUTSIDE the GUI (chat messages, tool rows, prose mentions) opens the
 * sidebar instead of a new browser tab. Gated by the caller through
 * `takeoverEnabled(url)` — the `browserInterceptLinks` master, the URL's
 * protocol flag (`browserInterceptHttp` / `browserInterceptHttps`) and the
 * target tab's enable switch — and a Ctrl/Cmd/Shift/Alt-modified click
 * always bypasses the takeover so the user can still force a real browser
 * tab.
 *
 * Only the GUI's OWN document is watched — links inside the browser tab's
 * sandboxed iframe live in another document and never bubble here (and
 * their clicks must keep working inside the sidebar).
 */

/** The pure decision: the URL to open in the sidebar, or null to let the
 *  click fall through. Extracted so the policy is unit-testable without a
 *  DOM. `anchorHref` must be the ABSOLUTE href (`<a>.href` already is).
 *  The protocol/same-origin policy lives HERE; the prefs gates (master +
 *  protocol flags + target enablement) live in the caller's
 *  `takeoverEnabled(url)` callback. */
export function shouldInterceptLink(anchorHref: string, selfOrigin: string): string | null {
  let url: URL
  try {
    url = new URL(anchorHref)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // Same-origin links are GUI-internal navigation (settings pages, tool
  // docs) — never routed into the sidebar.
  try {
    if (url.origin === new URL(selfOrigin).origin) return null
  } catch {
    // Unparsable selfOrigin (never in practice): intercept defensively.
  }
  return url.href
}

/**
 * Resolve an anchor to a workspace-relative file path, or null when the
 * target is not a workspace file.
 *
 * The host's markdown sanitizer drops every destination that is not
 * http(s)/mailto, so `[x](./docs/a.png)` renders as inert text with no anchor
 * at all — the host has no relative-link handler to fall through to. This is
 * the recognizer for that gap: explicit `./`/`../` syntax, a bare candidate
 * path, and an anchor the browser resolved against the GUI's own origin
 * (which is what a relative href looks like once `.href` is read).
 */
export function shouldInterceptRelativeFile(
  rawHref: string | null,
  anchorHref: string,
  selfOrigin: string,
): string | null {
  if (rawHref === null) return null
  const trimmed = rawHref.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return null

  // 1. Explicit relative syntax: `./foo.png`
  if (trimmed.startsWith('./')) {
    return trimmed.slice(2)
  }
  if (trimmed.startsWith('../')) {
    return trimmed
  }

  // 2. A candidate path with no web protocol.
  if (!trimmed.includes('://') && isCandidateFilePath(trimmed)) {
    return trimmed.replace(/^\/+/, '')
  }

  // 3. An anchor resolved against the GUI origin, e.g.
  //    `http://127.0.0.1:43120/docs/demo.png`.
  try {
    const url = new URL(anchorHref)
    if (url.origin === new URL(selfOrigin).origin) {
      const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      if (isCandidateFilePath(pathname)) {
        return pathname
      }
    }
  } catch {
    // Unparsable (never in practice): not a relative file.
  }

  return null
}

/** Whether a left-click may be taken over (unmodified left click only). */
export function isPlainLeftClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/**
 * Register the document-level click capture that funnels external links
 * into the sidebar. Returns the disposer (HMR-safe).
 */
export function registerLinkInterception(opts: {
  /** Whether the takeover may happen for THIS url (the caller's prefs
   *  gates: master switch, protocol flag, target enablement). */
  takeoverEnabled: (url: URL) => boolean
  /** Open the sidebar tab at `url` (the caller resolves the target type). */
  openInSidebar: (url: string) => void
  /** Open a workspace-relative link target in the sidebar's file surface.
   *  Omitted → relative links stay inert, exactly as the host renders them. */
  openFileInSidebar?: (path: string) => void
  /** The GUI's own origin (window.location.origin at registration). */
  selfOrigin: string
}): () => void {
  const onClick = (event: MouseEvent): void => {
    if (!isPlainLeftClick(event)) return
    if (event.defaultPrevented) return
    const target = event.target
    if (target === null || typeof (target as Element).closest !== 'function') return
    const anchor = (target as Element).closest('a[href]') as HTMLAnchorElement | null
    if (anchor === null) return
    // Relative workspace links first: they carry no absolute URL worth
    // routing through the external-link policy below.
    if (opts.openFileInSidebar !== undefined) {
      const relative = shouldInterceptRelativeFile(anchor.getAttribute('href'), anchor.href, opts.selfOrigin)
      if (relative !== null) {
        event.preventDefault()
        opts.openFileInSidebar(relative)
        return
      }
    }
    const url = shouldInterceptLink(anchor.href, opts.selfOrigin)
    if (url === null) return
    if (!opts.takeoverEnabled(new URL(url))) return
    event.preventDefault()
    opts.openInSidebar(url)
  }
  document.addEventListener('click', onClick, true)
  return () => { document.removeEventListener('click', onClick, true) }
}
