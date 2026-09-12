# Fork 增强清单（OmniMux）

本仓库是 dsh-better-sidebar 的 OmniMux fork（origin `laozhong86/DSH-better-sidebar`，
上游 `omdsh-dev/DSH-better-sidebar`）。上游有自己的路线；本文件记录 fork 在上游之上
多做了什么、依据是什么，供下一轮上游同步时逐块重裁，而不是重新考古。

**fork 规则**：同一能力面，上游已有更好实现 → 采用上游；fork 只为上游刻意留下的
空缺补洞。因此每次同步都要重新裁定，不要默认"自研一律保留"。

## 本轮基线

- 升级：`0.18.0` → 上游 tag `v0.19.1`（2026-09-12），分支 `feat/upgrade-v0.19.1`。
- 上游 v0.19.x 的关键变更：基线爬升到 DSH `0.1.5-rc.1+`（CI 钉 `rc.2`）、文件与
  Tab 图标改用宿主 `FileTypeIcon`/`CodeFileIcon`、新增对外 `registerFileIcon` API。

## 保留项（上游无等价实现）

### 1. 聊天内任意工作区路径可点击

- 文件：`src/client/candidate-paths.ts`、`src/client/intercept.tsx`
  （`registerFileMentionsInterception`）、`src/client/link-intercept.ts`
  （`shouldInterceptRelativeFile`）。
- 上游边界（有意为之，不是遗漏）：`chatFileMentions` 的词表来自 mutation 工具自己的
  `locations`，只匹配精确路径或唯一 basename，且该轮没有产出时整套词表直接关闭
  （`ui-deliverables/README.md`：“The vocabulary comes from the mutation tools' own
  `locations`, never from the closing prose”）。宿主 markdown 渲染的 `sanitizeUrl`
  只放行 `http(s)`/`mailto`，相对链接因此渲染成没有 anchor 的惰性文本。
- fork 补的行为：prose / inline-code 里被提到的候选工作区路径、相对 markdown 链接
  → 在侧边栏打开；目录 → 走文件管理器 reveal（编辑器对目录没有内容）。
- 接入点：`owner.openFile(path)` —— 宿主官方的"打开工作区路径"接缝（内部经
  `ctx.sidebarRight.openResource`），fork 不自造打开通道。
- 维护注意：宿主在 0.1.5 给 `forClosing` 加了第二个参数 `sessionId`，包装器必须原样
  转发（`originalForClosing.call(this, owner, sessionId)`）——丢失会让 presented 文件
  的打开收到 `undefined`。`tests/file-mentions-intercept.spec.ts` 有回归用例。

### 2. HTML 预览 = 有界不透明快照

- 文件：`src/html-preview-types.ts`、`src/html-preview-resource.ts`、
  `src/html-preview-document.ts`、`src/html-preview-syntax.ts`、
  `src/client/HtmlPreview.tsx`。
- 上游行为：预览 frame 的 `src` 指向 `/sidebar/html` 路由，而该路由的 trust fence
  拒绝沙箱 frame（opaque origin，`sec-fetch-site: cross-site` 与 `Origin: null` 两条
  分支都拒），桌面端表现为 `forbidden`；同时上游保留 `htmlViewerNoSandbox` /
  `htmlViewerDefaultUnsafe` 提权开关（开启时 iframe 丢掉整个 sandbox 属性）。
  上游 v0.19.1 在 HTML 预览这条线上零改动（`git diff v0.18.0..v0.19.1 --
  src/client/html-preview.ts src/html-route.ts` 为空）。
- fork 方案：受信主 GUI 通过 `html.preview` API 取回一份自包含快照（parse5/css-tree/
  es-module-lexer/saxes 纯解析，资源内联为 `data:` URL，预算 128 资源 / 16 MiB /
  深度 16），frame 只接收字符串（`srcDoc`），sandbox 固定且提权面已移除。
- 代价（有意接受）：依赖运行时 `fetch`、非字面量动态 `import()`、嵌套本地 HTML →
  变成显式诊断而不是静默失败；编辑模式仍是逃逸通道。

### 3. 内置视频 / 音频预览（range 206 流式）

- 文件：`src/client/builtins/viewers.tsx`（`video` / `audio` descriptor）、
  `src/client/icons.tsx`（两个图标）、`src/index.ts`（`/sidebar/file` 的 range 分支、
  流式读取、媒体上限提升）。
- 上游做法：视频预览**不内置**，作为第三方插件 `dsh-video-preview` 挂在市场条目里
  （`src/client/plugins-viewers.ts`）；音频连推荐插件都没有。
- fork 理由：OmniMux 预置 profile 未安装 `dsh-video-preview`，桌面产品要求开箱即用。
  若将来决定改为依赖外部插件，这一段可以整体删除。

### 4. 工具展示的媒体计入本轮产出

- 文件：`src/client/produced-files.ts`（`extractToolMediaPaths`）。
- 理由：`display_file` / `read_image` 展示的图片与视频是本轮交付物，但引擎的
  `deliverables` 记录只含文件变更；不补这一步，产出文件行会漏掉 AI 生成的媒体。

## 已移除项（本轮按上游裁定丢弃）

- `src/client/openpath-intercept.ts` + `registerOpenPathInterception`（曾以
  `defineProperty` 遮蔽 `remote.session.openWorkspacePath`，把聊天里的文件打开导流到
  侧边栏）。上游 commit `ba01147`（DSH 0.1.5-alpha.1 适配）删除并给出理由：0.1.5 的
  聊天改用 `ctx.sidebarRight.openResource` 打开文件，旧包装器**已无调用方**，且会
  **劫持宿主的 "open in app" 手势**。fork 基于该文件的目录路由增强随之作废。
- 随之一并去掉了 `interceptOpenPath` 偏好项与其设置行、locale 文案。

## 下轮同步检查清单

1. 逐块重裁：`git diff <merge-base> <fork HEAD> -- <文件>`；`src/client` 侧的纯增量
   hunk 在本轮可 `git apply --3way` 干净落盘。
2. 核对宿主契约变化：`chatFileMentions.forClosing` 的参数量、冷会话读取
   （`persistence.inspect` 已被 `readPersistedSessionOf` 取代）、
   `sidebarRight.openResource` 的地址语义。
3. 依赖取并集：`parse5` / `css-tree` / `es-module-lexer` / `saxes` / `acorn`、
   `@types/css-tree`（仅 fork 的 HTML 快照使用）。
4. 门禁：`pnpm typecheck && pnpm test && pnpm build`，再跑一次打包侧的实机验收
   （打开 `.html`、打开视频/音频、点聊天里的路径与相对链接）。
5. 批量改源码脚本一律写成 `.cjs` 文件再执行：`node -e '...'` 在 bash 单引号里改含
   引号的源码会踩 shell 引号陷阱（本轮曾有 19 个 locale 文件被写入字面 `+ v +`）。
