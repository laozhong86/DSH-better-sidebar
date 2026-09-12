/**
 * Interception of the chat's produced-files row: the turn-tail chain entry
 * that replaces ui-deliverables' row when the closing turn produced files.
 * The takeover looks identical (same chip row); the chips open the file in
 * the sidebar instead of the host OS. Priority -1 runs before the default-0
 * deliverables entry; when nothing was produced the selector returns null
 * and the original row renders unchanged.
 */
import { IconCodeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../context-types.ts'
import { isCandidateFilePath, isDirectoryPath } from './candidate-paths.ts'
import { revealPaths, type SidebarStore } from './state.ts'
import { t } from './locales.ts'
import { resolveSidebarPath, selectProducedFiles } from './produced-files.ts'
import css from './sidebar.module.css'

/** Open a file in the sidebar's editor (used by the intercepted row and the explorer). */
export function openSidebarFile(ctx: Context, store: SidebarStore, sessionId: string, path: string): void {
  // A directory carries no editor content: the editor would open an empty
  // buffer, so the explorer (where the row can actually be shown) is the only
  // meaningful destination.
  if (isDirectoryPath(path)) {
    revealInExplorer(ctx, store, sessionId, [path])
    return
  }
  const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
  const absolute = resolveSidebarPath(summary?.cwd, path)
  const at = Math.max(absolute.lastIndexOf('/'), absolute.lastIndexOf('\\'))
  const title = at === -1 ? absolute : absolute.slice(at + 1)
  // Route through the sidebar service so the editor descriptor's dedupeKey
  // (per-path) applies; the id is path-derived so multiple editors coexist.
  ctx.get('betterSidebar')?.openTab({ type: 'editor', title, path: absolute, id: `editor:${absolute}` })
}

/**
 * Reveal the produced files in the sidebar explorer: expand their parent
 * directories, highlight the rows, and focus the explorer tab. Unknown
 * files fall back to revealing the workspace root itself.
 */
export function revealInExplorer(
  ctx: Context,
  store: SidebarStore,
  sessionId: string,
  files: readonly string[],
): void {
  const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
  const cwd = summary?.cwd
  // Deliverables report paths as-is (often relative to the session cwd), but
  // the explorer tree and revealPaths work on absolute paths — resolve every
  // target so the ancestors expand and the row actually matches.
  const targets = files.length > 0
    ? files.map(path => resolveSidebarPath(cwd, path))
    : cwd === undefined ? [] : [cwd]
  store.reduce(state => revealPaths(state, cwd, targets))
  // Focus the single-instance editor home tab (the files window) where the
  // reveal highlight renders. Read via ctx.get like every other internal
  // consumer (#357): the provider is not on this fiber chain, so a direct
  // ctx.betterSidebar read can throw before optional chaining applies.
  ctx.get('betterSidebar')?.openTab({ type: 'editor', title: t('files') })
}

/** The intercepted produced-files row (visual twin of the deliverables chips). */
export function SidebarProducedFiles(props: {
  matched: readonly string[]
  openInSidebar: (path: string) => void
  /** Reveal the produced files in the explorer ("Show in folder" twin). */
  onShowInFolder: (files: readonly string[]) => void
}) {
  const { matched, openInSidebar, onShowInFolder } = props
  const shown = matched.slice(0, 6)
  const hidden = matched.length - shown.length
  return (
    <div className={css.producedRow}>
      <span className={css.producedLabel}>{t('produced')}</span>
      {shown.map(path => {
        const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
        const name = at === -1 ? path : path.slice(at + 1)
        return (
          <button
            key={path}
            type="button"
            className={css.producedChip}
            title={path}
            onClick={() => { openInSidebar(path) }}
          >
            <IconCodeOutline16 size={12} />
            <span>{name}</span>
          </button>
        )
      })}
      {hidden > 0 && <span className={css.producedMore}>+{hidden}</span>}
      {hidden > 0 && (
        <button
          type="button"
          className={css.producedMore}
          style={{ cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
          onClick={() => { onShowInFolder(matched) }}
        >
          {t('showInFolder')}
        </button>
      )}
    </div>
  )
}

/**
 * Register the turn-tail interception (returns the disposer).
 *
 * The slot is a CHILD slot the host's ui-conversation declares in its
 * `conversation.chat.node` children table (kind: chain, scope: session).
 * Registering it directly races the declaration — the ui-slots core's
 * load-time validation throws "not declared (a parent entry's children
 * table must declare it)" when the parent entry is not on the ledger yet.
 * slots.inject waits for the declaration: the callback runs synchronously
 * when the slot is already declared, otherwise it runs inside the declaring
 * register() call once the declaration commits; declaration collapse
 * disposes the entry and a later declaration re-registers it. This mirrors
 * @deepseek-ai/dsh-client-ui-deliverables' registration of the same slot.
 */
export function registerTurnTailInterception(ctx: Context, store: SidebarStore): () => void {
  return ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    // Decline the takeover while the editor tab type is disabled in the side
    // card settings: the produced-files row falls back to the default
    // deliverables behavior instead of offering chips that cannot open. Also
    // while the sidebar is externally disabled (aionui-panel chosen).
    select: (owner) => {
      if (store.getSuspended()) return null
      if (store.getPrefs().tabsEnabled['editor'] === false) return null
      return selectProducedFiles(owner)
    },
    priority: -1,
    registrant: 'dsh-better-sidebar',
    inject: (sessionId: string) => ({
      openInSidebar: (path: string) => { openSidebarFile(ctx, store, sessionId, path) },
      onShowInFolder: (files: readonly string[]) => { revealInExplorer(ctx, store, sessionId, files) },
    }),
  }, SidebarProducedFiles))
}

export interface MarkdownFileMention {
  open: () => void
  label: string
  title?: string
}

export interface MarkdownFileMentions {
  resolve(value: string): MarkdownFileMention | undefined
}

export interface TurnTailOwnerProps {
  seq: number
  openFile: (path: string) => void
  turn?: unknown
  nodes?: unknown
}

/** The host's mention face. 0.1.5 passes the session id as a second argument
 *  — the host resolver needs it to open presented files. */
export interface ChatFileMentions {
  forClosing(owner: TurnTailOwnerProps, sessionId: string): MarkdownFileMentions | undefined
}

/**
 * Widen the chat's file mentions beyond the host's produced-files vocabulary.
 *
 * The host resolver is deliberate about its scope: its word list comes from
 * the mutation tools' own `locations` — "never from the closing prose" — and
 * matches an exact path or a unique basename only. A workspace path the
 * assistant merely *mentions* in inline code (`docs/evidence/demo.png`,
 * `package.json`) therefore stays inert unless the closing turn produced it.
 *
 * The wrapper chains onto the host resolver rather than replacing it: the
 * original answer wins whenever it exists, and only an unmatched token falls
 * through to the candidate-path heuristic. The suspension switch and the
 * editor tab's enable toggle gate that fallback, so with the sidebar off the
 * host's behavior is untouched.
 */
export function registerFileMentionsInterception(ctx: Context, store: SidebarStore): () => void {
  const service = ctx.get('chatFileMentions') as ChatFileMentions | undefined
  if (service === undefined || typeof service.forClosing !== 'function') return () => {}
  if ((service as { __betterSidebarEnhanced?: boolean }).__betterSidebarEnhanced === true) return () => {}

  const originalForClosing = service.forClosing
  service.forClosing = function (this: ChatFileMentions, owner: TurnTailOwnerProps, sessionId: string) {
    // Forward the session id verbatim: the host resolver opens *presented*
    // files with it, and dropping it sends `undefined` into that call.
    const original = originalForClosing.call(this, owner, sessionId)
    return {
      resolve(value: string): MarkdownFileMention | undefined {
        const matched = original?.resolve(value)
        if (matched !== undefined) return matched
        if (store.getSuspended()) return undefined
        if (store.getPrefs().tabsEnabled['editor'] === false) return undefined
        if (!isCandidateFilePath(value)) return undefined
        return {
          // owner.openFile is the host's own "open a workspace path" seam
          // (it resolves through sidebarRight.openResource), so the open
          // lands where the host would have put it.
          open: () => { owner.openFile(value) },
          label: value,
          title: value,
        }
      },
    }
  }
  ;(service as { __betterSidebarEnhanced?: boolean }).__betterSidebarEnhanced = true

  return () => {
    service.forClosing = originalForClosing
    delete (service as { __betterSidebarEnhanced?: boolean }).__betterSidebarEnhanced
  }
}
