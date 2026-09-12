# Issue #1 独立 QA 报告

## 结论

2026-09-08。**Routing: NoOne（已验证代码范围无确认源码缺陷）；代码回归通过，完整功能/正式 App 验收未通过、Issue 不可关闭。** 两轮测试已用完；第一轮唯一失败为 QA 遗漏真实父组件 key 契约，第二轮修正测试后全部通过。没有要求 Engineer 修改该行为。

候选实际浏览器证据已经取得，但不足以声称所有架构验收项完成。尤其 remote scoped importmap 的真实远程加载、完整 SVG external-use 对照、原始样本交互和正式 Electron capability 路径仍缺证。缺证不是已证明的源码 Bug。

## 固定审查身份

- 工作树：`/Users/x/Desktop/Project/dsh-plugin/personal/dsh-better-sidebar/.worktrees/issue-1-html-preview`
- 指定 base = HEAD：`6fbfeedc0189e95a1c4d3908d3a58c784c5b7f15`，分支 `fix/issue-1-html-preview`，审查当前未提交文件（含 untracked 实现），未 fetch。
- `src/**`、package.json、pnpm-lock.yaml 完整文件内容 manifest 的 SHA-256：`9dae5f9d85ae9057e5f53c1162bed5180db56d1a06c050aedfc722026edaffe6`。
- 明细与算法输入：`tests/qa-issue1/evidence/source-identity.json`。源码在 QA 前后逐文件 SHA-256 相同。
- 测试页实际编译 HtmlPreview.tsx + 原 API 客户端 + React，未重写产品组件。独立 bundle SHA-256：`55e6d065954fc98f67030d34dbfafced2f5d0c0e9c4dc35d30175d3357678358`；可从 QA 构建配置重新生成。此 bundle 不是正式插件 loader 挂载证据。
- 完整读取 engineering 最新报告 98 行及 security-design 265 行；按其永久 opaque、无 frame RPC、允许无特权自导航/联网的裁定验收，不加入绝对禁网门槛。

## 测试结果

| 检查 | 独立结果 | 证据 |
| --- | --- | --- |
| typecheck + 正式插件 build（先于全量测试） | exit 0，所有 tsdown bundles 成功 | 本会话 bash-281 完整输出；最终 typecheck.log |
| 第一轮全量 | 126 suites pass / 1 fail；1353 pass / 9 skip / 1 fail | test-round1.log |
| 第二轮全量 | **127 suites / 1354 pass / 9 skip / 0 fail**，exit 0 | test-round2.log |
| 第二轮 typecheck | exit 0 | typecheck.log |
| 源码及 QA 文件 eslint | exit 0 | 本会话命令结果 |
| 全仓 lint | 最终 exit 0 | lint-clean.log |
| git diff --check | exit 0 | 本会话命令结果 |

以上日志均位于 `tests/qa-issue1/evidence/`。未收集 coverage instrumentation 百分比，不虚构覆盖率。

第一轮失败：`loads a fresh saved snapshot when selecting a newer operation for the same HTML path` 期望 htmlPreview 两次，实际一次。QA 最初直接复用 DiffPane 而遗漏 `ChangesTab.tsx:154–158,204–206` 的 `key=op:callId`。真实父组件切换 operation 时 remount 且渲染开关重置；修正测试按真实 key 重建并再次开启渲染后，第二轮通过。**撤销最初源码缺陷判断。**

全仓 lint 首次扫描了 QA 临时生成的 React bundle/fixtures，出现第三方生成码诊断；本任务服务停止后清理这两个 task-owned 目录，再运行 lint 通过。未改源码/官方 eslint 规则，也没有第三轮单元测试。

## 代码与安全审查

- html.preview 仅使用 attached session header 或 persistence meta 的 cwd；不接受客户端任意 workspace。API 沿用受信 dispatch/envelope，信号传入 reader。
- resource reader 每资源调用 `ensureWorkspacePath(...,true)`；MIME 白名单、128资源、16MiB累计读取/输出、递归上限、常规文件与 NOFOLLOW/NONBLOCK/descriptor inode 校验、结束重新验证均存在。已有路径/symlink/预算/取消测试本次全量通过；不宣称证明全部恶意 ancestor ABA 竞争。
- builder 仅 Node parser，无 DOM/远程 fetch/eval；HTTP(S)/data/blob 留给 frame 原生加载。无 capability、header、cookie 或服务端 credential proxy 加入快照。
- CSS/module/SVG graph 按引用资源基址序列化；SRI 先核对原 bytes，再计算生成 bytes 摘要；remote metadata 原样保留。scopes/局部 import.meta/srcset/SVG XML 的现有回归本次全量通过。
- HtmlPreview 初建固定 sandbox，没有 allow-same-origin/top-navigation/escape-sandbox；identity/generation 切换先清除旧 frame，cleanup abort + current guard 丢弃旧响应。
- TextEditor 保存成功递增 generation；DiffPane 经真实 ChangesTab callId key 重建。单元行为通过不等于实际 CodeMirror 保存成功/失败 UI 全流程证据。
- 无新增消息监听/文件 RPC。QA fixture 的消息接收器只用于捕获受控 probe，**不属于产品实现**。

## ego-browser 候选实际证据

使用 ego task 31；正式 `http://127.0.0.1:43120/` DOM 仍只有 forbidden，无 iframe。没有伪造 header、取 token 或关闭 ordinary-browser gate。此结果不是原始 iframe 重现。

用户允许的隔离 task-owned 服务 URL 本次为 `http://127.0.0.1:54694/`（已停止）。它用真实 server builder 预构建快照，用 task-owned JSON API 外壳供应真实客户端组件；不安装插件、不启动替代 DSH GUI、不声称此端口更新 43120。

| 场景 | 观测 | 限制 |
| --- | --- | --- |
| SRI classic + SRI module | classic=true、module=true | 受控本地无环依赖 |
| CSS ../shared + nested @import + SRI | computed color=rgb(12,34,56) | SVG fragment background 尚未做逐像素对照 |
| srcset 含 data URL 与本地 SVG候选 | naturalWidth=10，图片加载成功 | 非完整 DPR/descriptor 浏览器矩阵 |
| 初始 opaque frame | event.origin=null；parent DOM/storage/cookie denied；require/process undefined | 普通 Chromium，不是 Electron IPC证明 |
| 自身 location.replace→302→同测试父 origin landing | 接收到 landing probe；origin=null，parent DOM/storage/cookie denied，parent URL不变；iframe sandbox不变 | 直接向现有候选 frame 设置受控 srcdoc 作为平台探针，不冒充产品 API 场景 |
| OOPIF | 受控子 target URL=landing、type=iframe、canAccessOpener=false | 不等于 Electron webRequest.details.frame.origin 采样 |

数据见 `browser-compat.json`、`browser-navigation.json`。scope=false 是未加入 remote scoped fixture 的探针默认字段，**不是 remote scopes 已失败或已验证**。没有把 URL 变化当联网成功：302 landing 实际执行 probe 才计该受控 HTTP 流程成功。

原始样本：只读 `/Users/x/Desktop/Project/dsh-plugin/product/omnimux-dsh/tmp/skill-workshop-demo.html`，通过原始 bytes HTTP 页面与候选 server AST snapshot 两种方式在 ego 实际打开。两者均出现 Skill 标题、分类、卡片及内联 SVG；候选 srcdoc 长度35147。`sample.png`、`original-sample.png`、`original-dom.txt` 和 `sample-identity.json` 保留证据；结束复核原文件 SHA-256 不变。没有覆盖样本，也没有执行安装/文件选择操作。**只是初始渲染对照，不是所有交互成功，更不是正式 sidebar 原失败消失。**

## Electron 证据边界

加载 huashu-mac-use，使用现成内核只读 `mac windows DSH` 观测到 DSH Desktop 窗口 id81158/pid75281。针对 `/Applications/DSH Desktop.app/Contents/` 进程查询 LISTEN TCP 无现有诊断监听（lsof exit1）；未启用 CDP、未重启 App、未编译/修改外部 skill、未探索凭据或隐藏 bypass。

因此本轮 **无法证明**：实际 Electron 子 frame 初次导航/提交后 fetch/HTTP redirect/WS/process swap 时 capability header 不注入；preload/File path bridge/Node/IPC 不可用；运行 bundle 与磁盘 identity 相同；正式宿主 CSP 继承及原始失败调用链已修复。普通 Chromium 的 require/process undefined 不替代这些 Electron 项。L2/AX截图也不能证明网络 header 分类，不继续无界探测。

## 合并安装前与安装后门槛

### 合并前必须（owner：主理人/后续受限 QA）

1. 保持候选源码身份，若再改源码则重新声明 identity；审阅测试与报告、正常 PR/CI。
2. 补齐尚缺的候选真实行为：remote scoped importmap/CORS、SVG external-use 及内部引用原版对照、原始样本安全交互、TextEditor保存成功/失败和stale路径切换。已有自动化通过不能替代这些 UI证据。
3. 明确安全补证的现有合法诊断通道与合并/安装分阶段验收计划。若正式 Electron 通道仍不可用，记录条件验收缺口，不以此制造“未安装版本必须已在正式App运行”的循环。
4. 包装/挂载依赖与产物清单由正规 PR门禁核验；本 QA 未运行 scratch profile 安装或 plugin-mount（本阶段禁止 install/profile变更）。

### 合并后、安装前必须（owner：主理人）

从 merged commit 构建正规包、核验 tarball/版本/来源和当前正式 desktop profile，准备最小受管恢复路径；仅按已有用户授权及真实 packaged CLI 执行，不手拷 profile，不修改官方源码。不得以 NoOne 当正式发布运行验收通过。

### 正规安装后必须（owner：主理人协调运行 QA）

验证正式 App实际激活的候选版本；实际侧栏打开只读原始样本，确认 forbidden消失、交互/SVG/样式/脚本；两入口及旧unsafe prefs四组合、保存刷新/失败/stale切换；完成设计 S2/S3/S4/S8 的 Electron导航/重定向/OOPIF、HTTP/WS header存在布尔及IPC/preload隔离。只有全部满足后才能关闭Issue；不要求绝对禁网。

## 可执行下一步

主理人收集本报告；无需把已撤销的 DiffPane测试缺陷路由 Engineer。继续候选浏览器剩余矩阵与正规 PR门禁准备，Electron现有诊断缺口单独跟踪。重建隔离页：`pnpm exec tsdown -c tests/qa-issue1/build.config.ts && pnpm exec unrun tests/qa-issue1/server.ts`，它输出随机QA_URL；只在受管后台启动、结束停止并清理生成目录。两轮单元测试已结束，不开展第三轮回归循环。

本轮仅写 QA测试/fixtures工具/证据及本报告；无 commit/push/merge/install/profile更改/官方源码更改/重启/自行委派。浏览器 task与测试服务均关闭。没有 report 工具，本文件及最终回复作为结构化回传。

## PR 证据收录边界（2026-09-08）

候选 PR 仅收录回归测试 `tests/qa-issue1/diff-refresh.spec.tsx` 与原始 `evidence/source-identity.json`。上述浏览器 JSON、截图、DOM、用户样本身份及日志仅留在本地，不随 PR 发布；临时 server/browser/build 配置亦排除。因此上述本地证据路径不是仓内可下载附件，重建命令仅适用于保留工具的原 QA 工作树。提交准备逐项复核 manifest 全部 170 个文件哈希一致；不改写 QA identity 来掩盖实现变化。工程报告中的历史检查结果仍保留，当前验收状态以本报告为准。
