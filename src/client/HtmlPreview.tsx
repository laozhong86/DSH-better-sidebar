/** The GUI reads saved snapshots; untrusted frames receive only serialized HTML. */
import { useEffect, useState } from 'react'
import { api, type SessionScope } from './api.ts'
import { HTML_IFRAME_SANDBOX } from './html-preview.ts'
import { t } from './locales.ts'
import type { PreviewSnapshot } from '../html-preview-types.ts'

export function HtmlPreview(props: { scope: SessionScope; path: string; generation?: number; className?: string }) {
  const { sessionId, cwd } = props.scope
  const identity = JSON.stringify([sessionId, cwd, props.path, props.generation ?? 0])
  const [result, setResult] = useState<{ identity: string; snapshot?: PreviewSnapshot; error?: string } | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    let current = true
    api.htmlPreview({ sessionId, cwd }, props.path, abort.signal).then(snapshot => {
      if (current) setResult({ identity, snapshot })
    }).catch((error: unknown) => {
      if (current) setResult({ identity, error: error instanceof Error ? error.message : String(error) })
    })
    return () => { current = false; abort.abort() }
  }, [sessionId, cwd, props.path, identity])
  if (result?.identity !== identity) return <div role="status">{t('loading')}</div>
  if (result.error !== undefined) return <div role="alert">{result.error}</div>
  if (!result.snapshot) return null
  return <iframe key={identity} className={props.className} title={props.path}
    sandbox={HTML_IFRAME_SANDBOX} referrerPolicy="no-referrer" allow=""
    srcDoc={result.snapshot.html} />
}
