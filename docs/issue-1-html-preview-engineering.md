# Issue #1 HTML preview — engineering handoff

## Result and scope

2026-09-08. **Engineering IS_PASS: YES — bounded code contract and offline quality gates.** This is not complete Issue acceptance, original-sample success, Electron isolation proof, or release approval. Formal UI/Electron acceptance remains **QA pending**. The previous blanket scoped-map/import.meta exclusions and raw external SVG treatment have been corrected in the existing candidate, not replaced with a new architecture.

Worktree: `/Users/x/Desktop/Project/dsh-plugin/personal/dsh-better-sidebar/.worktrees/issue-1-html-preview`; branch `fix/issue-1-html-preview`; local base and HEAD `6fbfeedc0189e95a1c4d3908d3a58c784c5b7f15`. Review target is the current uncommitted local diff plus untracked candidate files, not a fetched PR head. No fetch, commit, push, merge, install into DSH, profile change, restart, replacement server, official/App modification, user-sample edit or delegation occurred.

[Security design](issue-1-preview-security-design.md) remains authoritative. Network/self-navigation may occur only with the frame's unprivileged browser behavior. No generic bundler, remote proxy, file RPC, capability URL or host change was added.

## Implemented behavior

- `html.preview` reuses POST dispatch, existing envelope and trust fence. Workspace comes from the attached session or authoritative persistence metadata, never arbitrary client cwd. Every local dependency calls `ensureWorkspacePath(..., true)` irrespective of the legacy workspaceFence preference.
- Server-only parse5/css-tree/es-module-lexer plus Acorn (metadata AST inspection) and saxes (XML SVG parsing). Parsing does not execute HTML/JS, fetch remote resources or create a privileged browser DOM. New direct parser dependencies were already cached; `pnpm install --offline --ignore-scripts` downloaded zero packages.
- Local relative paths resolve against each referring resource, including workspace-local `../shared`. Input/output and cumulative serialized dependency budgets are 16 MiB, intersected with readLimit/mediaLimit; 128 canonical resources, dependency depth 16, sequential I/O. HTML element and SVG node/depth budgets apply.
- Reads use pre-open stat, O_NOFOLLOW/O_NONBLOCK, descriptor regular-file/inode checks, bounded size+1 read and post-read identity/canonical checks; final stamps are revalidated. This is not an atomic OS snapshot or proof against every ancestor ABA race.
- CSS links/imports retain media/layer/supports structure. Static/literal-dynamic module dependencies are serialized bottom-up with canonical identity. Classic script order/async/defer and remote HTTP(S)/data/blob references remain native.
- Import maps normalize URL keys, targets and scopes against the original document base. Local scopes resolve longest-first with outer/global fallback; exact/prefix mappings participate in the same module graph. Null blocks are honored. Remote scopes/mappings are retained for native remote graphs; consumed local scopes are not emitted as meaningless file-origin scopes for data modules.
- Harmless `import.meta.env`, guarded `import.meta.hot`, direct console metadata inspection and literal computed properties are no longer blanket-rejected. Acorn inspects actual syntax rather than matching source comments/strings. Runtime resolver access, unknown computed/aliased metadata and escaping/relative-construction uses of import.meta.url receive specific diagnostics. Allowed url inspection observes the serialized module URL, not a leaked absolute workspace filename.
- External SVG uses XML parsing, preserves namespace/case/fragment semantics, and recursively rewrites style/CSS presentation URLs, href/xlink:href, src/poster/srcset and static script dependencies. xml:base is applied before removal. Inline SVG namespaced xlink attributes and presentation URLs are handled. XML is never evaluated and DTDs are not expanded.
- srcset uses URL/descriptor scanning states, retaining data commas and trailing-comma separators, density/exponent/width/height descriptors. Browser-invalid candidates are ignored without reading their paths, rather than accidentally merging candidates into one URL.
- Local SRI selects the strongest recognized algorithm (sha512 > sha384 > sha256), accepts any matching digest at that strength and handles options/base64 forms. Unsupported metadata follows the no-enforcement behavior; it is not silently stripped. Original bytes are checked before transformation; emitted local resource integrity is replaced by SHA-256 of the actual decoded serialized bytes. Remote integrity/crossorigin stays unchanged. SVG script integrity follows the same checks.
- TextEditor/DiffPane retain shared `HtmlPreview`. Every iframe is created with fixed `allow-scripts allow-popups allow-downloads allow-modals`, never same-origin/top-navigation/escape-sandbox. Legacy HTML unsafe preferences cannot unlock it; BrowserView remains unchanged.
- Saved-byte snapshots only. Editor save success changes generation. Identity changes/unmount abort and reject stale completions; parent loading/error replaces stale frames. Response close cancels server reads. Initial srcDoc prepends no-referrer and object-src none/base-uri none while preserving stricter user CSP.

## Final complete candidate file list

All paths below are relative to the worktree. Generated ignored `lib/` bundles/declarations were rebuilt, not installed or committed.

| Category | Files |
| --- | --- |
| New static graph source | `src/html-preview-types.ts`, `src/html-preview-resource.ts`, `src/html-preview-document.ts`, `src/html-preview-syntax.ts` |
| New shared client | `src/client/HtmlPreview.tsx` |
| New tests | `tests/html-preview-resource.spec.ts`, `tests/html-preview-document.spec.ts`, `tests/html-preview.spec.tsx` |
| Modified infrastructure | `package.json`, `pnpm-lock.yaml`, `.gitignore` (pre-existing worktree ignore) |
| Modified server integration | `src/index.ts`, `src/context-types.ts`, `src/wire.ts` |
| Modified client integration | `src/client/api.ts`, `src/client/TextEditor.tsx`, `src/client/changes/DiffPane.tsx`, `src/client/html-preview.ts`, `src/client/builtins/viewers.tsx` |
| Modified existing tests | `tests/smoke.spec.ts`, `tests/sandbox-views.spec.tsx`, `tests/builtins.spec.ts` |
| Modified guide | `docs/external-plugin-guide.md` |
| New report/design artifacts | `docs/issue-1-html-preview-engineering.md`, `docs/issue-1-preview-security-design.md`, `docs/system_design.md`, `docs/class-diagram.mermaid`, `docs/sequence-diagram.mermaid` |

This continuation changed only package/lock, document builder, new syntax helper, document tests and this report. Architecture files, client implementation, user samples and other candidate work were preserved. No new locale key or visual control was introduced.

## Verification evidence

Commands ran in the specified worktree. No global Git configuration changed.

```bash
pnpm install --offline --ignore-scripts
pnpm typecheck
pnpm build
GIT_AUTHOR_NAME='Sidebar Test' GIT_AUTHOR_EMAIL='sidebar-test@example.invalid' \
GIT_COMMITTER_NAME='Sidebar Test' GIT_COMMITTER_EMAIL='sidebar-test@example.invalid' pnpm test
pnpm lint
git diff --check
```

| Gate | Final result |
| --- | --- |
| Offline dependency linking | Exit 0; acorn 8.18.0 / saxes 6.0.0; zero downloaded |
| Typecheck | Exit 0 |
| Full build before tests | Exit 0; declarations and all tsdown bundles |
| Full tests | **126 suites passed, 1353 tests passed, 9 skipped, zero failures; exit 0** |
| Targeted compatibility/lifecycle first run | 35/35; subsequent added SVG SRI test passed in final full run |
| Complete candidate TS/TSX eslint | Exit 0 |
| Full repository `pnpm lint` | Exit 0 |
| Diff review and `git diff --check` | Exit 0; tracked integration diff and untracked source inspected |
| Formal ego GUI | Not retried here; preceding report's real 43120 probe returned forbidden, not an original-preview reproduction |
| Formal UI/Electron | QA pending; no installation/restart in this phase |

The first full continuation run passed 1352 tests; final SVG-integrity coverage increased this to 1353. Nine existing skips are four fs-tree platform cases, four PowerShell cases and one HTML route case. Existing tsdown bundling advisories, React act/useLayoutEffect warnings, jsdom navigation/canvas warnings and deliberate crash fixtures remain non-failing.

## Acceptance matrix and precise remaining bounds

| Contract area | Offline evidence | Runtime/semantic boundary |
| --- | --- | --- |
| Remote scoped import maps | Normalized remote scope retained; local scopes/prefixes resolved; exact local/remote map regressions pass | Remote CORS and browser import-map loading need QA. Multiple maps and import-map integrity fields diagnose explicitly; remote scopes pointing to local prefixes diagnose runtime-discovery requirement. Local prefix mappings are statically consumed, not runtime filesystem resolvers. |
| import.meta | env/hot/url inspection and computed literal cases pass; alias/resolve/relative URL construction errors tested | Arbitrary metadata dataflow is not a JS compiler. Escaping url/metadata and unknown computed access diagnose instead of pretending to preserve original file-base semantics. No TS/JSX/npm/HMR/service-worker implementation. |
| External/inline SVG | Nested CSS/href/xlink/xml:base, fragments, presentation URLs, path escape and SVG SRI tested | XML DTD/entity declarations, xml-stylesheet processing instructions and external SVG module scripts get localized diagnostics. Browser external-use/data-URL support and image-mode script restrictions remain native and need comparison with the original. |
| srcset | Trailing commas/data URLs/exponents/width-height/invalid candidates pass; invalid references are not read | Real responsive selection and browser serialization comparison remain QA evidence, not established by parser tests. |
| SRI | Stronger mismatch defeats weaker match; options accepted; transformed CSS/module hashes equal actual emitted bytes; SVG checks; remote metadata retained | Native browser SRI/CORS eligibility and mixed browser versions remain QA. No digest is merely retained against changed bytes or silently removed. |
| Relative resources / modules | `../shared`, CSS imports/font/image, literal dynamic imports and canonical module reuse pass | Cyclic modules/CSS and nonliteral dynamic imports explicitly diagnose; no general bundler. Nested local HTML still diagnoses. |
| S1 fixed iframe / preferences | Shared component and sandbox tests pass; no same-origin or unlock path | Full async persisted-prefs matrix and navigation persistence in formal Electron pending |
| S2–S4 navigation/capability/IPC | No new bridge, message listener, credential API or parent parser; fixed sandbox source review | Navigation/redirect/OOPIF, HTTP/WS header classification, storage/Node/preload access require independent Electron evidence |
| S5 workspace/budgets | Resource containment, symlink/unknown MIME/budgets/replacement/cancel tests pass | Exhaustive hostile ancestor ABA/FIFO/device stress not claimed |
| S6–S8 server isolation | Parser-only implementation, no remote fetch; trust fence and authoritative workspace regressions pass | Browser outbound requests remain unprivileged; no absolute-egress claim. Formal native header redaction/gate evidence pending |
| Save / cancellation | Generation/path race/error clearing/unmount cancellation regression passes | Actual CodeMirror save failure/success and repeated DiffPane operation refresh require QA |
| Original user sample | Sample disk files untouched | Must be opened through actual formal sidebar by QA; no original-vs-candidate browser success claimed |

## Global review verdict and next owner

**IS_PASS: YES for this bounded engineering handoff.** Cross-file review covered server/client import separation, API envelope and trust fence, authoritative workspace, per-resource authorization, shared permanent sandbox, cancellation, canonical graph cache, strongest-hash SRI, parser dependencies and unchanged BrowserView. No code-quality gate is being blocked by ordinary-browser 403, nor is 403 counted as UI success.

Remaining semantic restrictions are diagnosed local features, not blanket bans on modules, import maps, SVG or remote resources. They are not a claim of full web-platform emulation. Static serialization is not an OS-atomic multi-file snapshot and can change observables such as resource/module URLs. Independent QA must compare originally-working, originally-forbidden/CORS-limited and candidate-failing cases separately.

Next owner: coordinator prepares the fork draft PR and normal CI against this exact candidate. Independent QA has completed two rounds; see [the latest QA report](issue-1-html-preview-qa.md) for its bounded NoOne result, candidate browser evidence and remaining acceptance matrix. Do not start another QA loop implicitly. Formal sidebar, save/refresh and Electron S1–S8 evidence remain incomplete; merge and official-profile installation stay gated. Keep Issue #1 open until formal runtime acceptance succeeds.

No `report` tool is exposed in this session; this persisted report and final response are the structured return.
