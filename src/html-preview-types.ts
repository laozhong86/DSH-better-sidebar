/** Serializable output of one authorized, saved-file preview. */
export interface PreviewWarning { code: string; message: string }
export interface PreviewSnapshot {
  html: string
  revision: string
  warnings: PreviewWarning[]
  resourceCount: number
  byteLength: number
}
export interface PreviewLimits { readLimit: number; mediaLimit: number }
