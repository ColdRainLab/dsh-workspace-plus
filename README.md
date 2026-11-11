# dsh-workspace-plus（自定义工作区 + 移动会话 + 工作区记忆）

> 侧栏「工作区」右侧的 **＋**（快捷键 `Ctrl+Alt+O`）不再弹文件夹选择器，而是弹「新建工作区」命名框：
> 输入名称 → 自动创建同名文件夹 → 新建指向它的工作区并打开一个新会话。适合按分类（数学 / 开发 / 硬件…）快速建工作区。
>
> 任意会话的「…」菜单里还多了一行 **「移动到工作区…」**：选一个目标工作区，就能把这条会话整体搬过去（复制完整历史生成新会话，原会话归档隐藏）。
>
> 设置里新增 **「工作区记忆」**：按工作区开关。开启后，会话上下文达到上限触发 DSH 自动压缩时，本轮结束会自动开一个新会话（带续接提示），新会话还能用 `workspace_memory` 工具查看本工作区其他任务的历史。

## 交互

### 新建工作区

1. 点侧栏「工作区」右侧 **＋**（或按 `Ctrl+Alt+O`；`Ctrl+O` 也接受）→ 弹出「新建工作区」对话框。
2. 名称：分类名，例如“数学”“开发”“硬件”；父目录会自动填好（可改）：
   - 默认父目录 = **最早创建的工作区的父目录**（也就是默认工作区所在的父目录），新目录会和现有工作区做邻居；
   - 还没有任何工作区时回退到 `<DSH_HOME>/workspaces`。
3. 对话框实时显示「将创建：<父目录>\<名称>」。
4. 点「创建」：
   - 本插件宿主自动建同名文件夹（已存在则复用，不覆盖内容；已有工作区指向它则报错）；
   - 再通过 DSH 原生工作区接口注册工作区，并像原生流程一样在它里面打开新会话；
   - 侧栏出现该工作区，对话框关闭。
5. 取消：按钮 / Esc / 点遮罩。

### 移动会话到其他工作区

1. 悬停任意会话行 → 点行尾 **「…」** → 菜单里选 **「移动到工作区…」**。
2. 对话框列出除当前工作区外的所有工作区（带会话数）；选中目标，点「移动」。
3. 成功后：目标工作区出现同标题、完整历史的新会话并自动打开；原会话进入**归档**（原 ID 与日志保留，可在视图的「已归档」筛选里找到并取消归档）。
4. 若当前会话正在运行，移动会先停掉它再归档（`stopActivity`），不会静默卡住。

### 工作区记忆

1. **设置 → 工作区记忆** 里列出所有工作区，每个一个开关（立刻持久化到 `<DSH_HOME>/workspace-plus/workspace-memory.json`）。
2. 开启后，当本工作区的会话上下文达到上限、DSH 自动压缩（`compaction/summary`）并且本轮结束（`turn/end`）时，宿主排队一条续接记录；浏览器轮询到后会在同一工作区**打开一个新会话**，输入框预填续接提示（含旧会话标题、上下文已达上限的说明、压缩摘要节选），由你确认后发送。
3. 新会话里可以使用 **`workspace_memory`** 工具（仅当本工作区开关开启时可用）：
   - `action=list`：列出本工作区最近的会话（标题 / 时间 / ID）；
   - `action=search` + `query`：对本工作区历史做全文检索，返回命中片段；
   - `action=read` + `session_id`：读取本工作区某个会话的最近内容。
   工具会校验调用者所在工作区，跨工作区的会话一律拒绝。
4. 关闭开关：不再自动续接，`workspace_memory` 对本工作区返回「未开启」。

## 说明与限制

- DSH 的工作区**必须绑定一个目录**，所以“自定义工作区”仍然有自动创建的目录；本插件只是把“选目录”换成“起名字”。
- 名称会作为文件夹名：不能包含 `<>:"/\|?*`、不能以句点结尾、不能是 Windows 保留名（CON、NUL…），最长 80 字符。
- 同名目录已存在且没有工作区指向它时会直接复用；已有工作区指向它则提示「已经有工作区指向这个目录」。
- 只能新建工作区；已有会话的归属目录不会变化（DSH 按会话创建时的工作目录归属）。要归到新分类，就在新工作区里开新会话。
- 原生「工作区行菜单 → 重命名 / 删除工作区」保持不变；删除工作区不会删除会话或目录。
- 移动会话的语义是 **「克隆 + 归档原会话」**：DSH 把会话绑定在创建时记录的 `cwd` 上，且没有原地改 ID/目录的接口，所以新会话会得到**新的会话 ID**；原会话不会删除，只是归档（日志仍保留）。
- 移动会在克隆前改写复制过来的 `session-log-deepseek/delivery-accepted`（官方会话日志上传水位）标记，把它们全部改指新会话。**0.3.2 之前**移动出来的会话，日志里仍留着指向原会话的标记，打开时会报「历史加载失败：… stored log is corrupt: SessionFormatError: current-generation delivery marker names the wrong Session」——需要把这些标记改写为新会话 ID（只改 `data.sessionId`，其余字节不动）再重新压缩；DSH v4 校验器只接受标记与所在会话同名（fork 继承前缀里的父标记除外）。
- 移动后历史与标题完整，但少数**按会话 ID 记录的附属数据**（文件变更摘要、`present` 展示物等）不会跟着复制：首次打开移动后的会话，侧栏可能缺个别变更徽标，控制台可能出现对应 `/api/changes.summary`、`/api/present.open` 的 404/500（不影响对话阅读与继续使用）。
- 空白草稿（还没写过第一轮的会话）没有持久化日志，移动会提示「无法读取会话」；先在旧工作区聊一轮或直接新建会话即可。
- 工作区记忆的「自动开新会话」在**压缩发生且本轮结束**后触发（压缩期间的半截回合不会被打断）；续接提示只是预填草稿，不会自动发送。旧会话保留（可继续查看），是否归档由你决定。
- `workspace_memory` 只读本工作区、只返回文本摘要/片段；它依赖宿主的 `sessionQuery.searchSessions`（缺少该能力的部署会降级为 list/read 可用、search 报错）。

## 实现要点

| 半边 | 文件 | 说明 |
|---|---|---|
| 宿主 | `lib/index.js` | 纯 ESM：`GET /api/workspace-plus/config`（默认父目录）、`POST /api/workspace-plus/create`（校验名称、建/复用目录、查重、返回真实路径）、`POST /api/workspace-plus/move-session`（读源日志 → 把复制来的 delivery 标记改指新会话 → `agents.create` 以目标 `cwd` 克隆完整历史 → 持久化屏障 → `workspace.attachSession` → 归档源会话）、`GET/POST /api/workspace-plus/memory`（工作区记忆开关）、`GET /api/workspace-plus/memory/pending`、`POST /api/workspace-plus/memory/ack`；监听 `session/event` 的 `compaction/summary` + `turn/end` 排续接；注册模型工具 `workspace_memory` |
| 浏览器 | `lib/client.js` | 不占用 `sidebar.workspaces.directoryFlow`（那是的原生目录选择器座位，抢占会让原生选择器条目激活失败、整个客户端启动报“Failed to load plugins”）；改为在捕获阶段拦截 ＋ 按钮（按本地化的 `aria-label`）与 `Ctrl+Alt+O`，用 `shell.overlay` 渲染命名框；会话菜单项与移动对话框分别占用 `sidebar.workspaces.session.menu.item` + `shell.overlay`；设置分区占用 `settings.section`；续接轮询器占用 `shell.overlay` |
| 宿主单测 | `tests/host.test.mjs` | 26 项：名称校验、默认父目录、建目录/复用、查重、HTTP 契约、移动克隆/复制标记改指/同目录拒绝/服务缺失/归档失败/移动路由、记忆存储、开关持久化、压缩续接排队/关闭不排队、`workspace_memory` 的 list/search/read/跨工作区拒绝、记忆路由 |
| 客户端单测 | `tests/client.test.mjs` | 17 项：触发识别（＋/快捷键）、对话框状态、配置预填、提交链路（建目录→建工作区→开新会话）、错误保留、空名拒绝、取消/Esc、busy、Endfield 主按钮样式、移动菜单项/目标列表/移动提交/失败/空目标、工作区记忆开关面板、续接轮询打开新会话并 ack |

服务端不联网、不执行外部命令；只做文件系统目录创建与 `workspaceRegistry.resolveByPath` 查重、会话日志读取与克隆。路由只绑定本机回环地址。

> 设计教训：最初版本直接占用 `sidebar.workspaces.directoryFlow` 座位来替换原生日录选择器。该座位是 single 槽，而原生目录选择器是宿主在启动后**动态挂载**的 Loader 条目——抢座位会让它的激活抛错，客户端启动直接失败。改成“不占座位、只拦触发”后，原生选择器与启动流程都保持完好。

## 安装 / 卸载

```powershell
& "D:\Program Files\Deepseek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "C:/Users/ROG-STRIX/.dsh/plugin-archives/dsh-workspace-plus/v0.3.2/dsh-workspace-plus-0.3.2.tgz"

& "D:\Program Files\Deepseek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove dsh-workspace-plus
```

安装后宿主热加载，**刷新页面**（Ctrl+R）生效。卸载即恢复原生文件夹选择器。

## 兼容性

- `engines.dsh`：`>=0.2.1-rc.2`（开放上界）。
- 依赖：工作区 RPC、`uiWorkspace.startSession`、`shell.overlay` 槽；这些在 0.2.1-rc.3 上验证（含隔离 web 实例的端到端：点＋→命名→建目录→工作区出现→无控制台报错）。
- 若未来宿主改了 ＋ 按钮的 aria-label 或工作区接口，插件可能失效，但原生文件夹选择器会照常工作（不会把客户端弄挂）。

## 测试

```powershell
& "C:\Users\ROG-STRIX\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" plugins\dsh-workspace-plus\tests\host.test.mjs
& "C:\Users\ROG-STRIX\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" plugins\dsh-workspace-plus\tests\client.test.mjs
```

## 版本记录

**0.3.3**

- 去掉包内硬编码的终末地配色：`html[data-dsh-endfield]` 下的黄色规则改为只引用主题变量（`--ef-y` / `--ef-y-hi` / `--ef-y-20` / `--ef-y-45` / `--ef-y-12` / `--ef-ink-1000`），不再写 `#f2f013`、`#fbfa6a`、`rgba(242,240,19,…)`。
- 没有安装终末地主题的机器行为不变（这些规则本来就不生效）；装了主题的机器视觉不变（变量值相同）。

**0.3.2**

- 修复「移动会话后打开报历史加载失败」：克隆时复制过来的 `session-log-deepseek/delivery-accepted` 标记仍指向原会话 ID，DSH v4 校验器判定 stored log 损坏（`current-generation delivery marker names the wrong Session`）。现在 `move` 在 `agents.create` 之前把标记的 `data.sessionId` 改写为新会话 ID，其余行按原对象透传、源事件不被修改；不带 `sessionId` 的畸形/未来形态标记保持原样。
- 修复适用于新移动；0.3.0 及更早版本已经移动出来的会话，其日志需要做同样的标记改写（`data.sessionId` → 所在会话 ID）后重新压缩，见「说明与限制」。

**0.3.0**

- 新增「工作区记忆」设置分区：按工作区开关，持久化到 `<DSH_HOME>/workspace-plus/workspace-memory.json`。
- 自动续接：监听 `compaction/summary` 与 `turn/end`，开启记忆的工作区在上下文压缩、本轮结束后排一条续接；浏览器轮询 `memory/pending` 打开同工作区的新会话，预填续接提示（旧会话标题 + 压缩摘要 + 使用 `workspace_memory` 的指引），ack 后清理。
- 新增模型工具 `workspace_memory`（list / search / read），只读调用者所在工作区，跨工作区拒绝，开关关闭时拒绝使用。
- 宿主挂载后写 `<DSH_HOME>/workspace-plus/diagnostics.json`，记录 routes / sessionEvents / workspaceMemoryTool 与错误，方便区分「宿主仍是旧版本」和「新版本某部分没挂上」。
- 注意：宿主半边（路由、工具、事件监听）的更新需要**重启 DSH** 才会加载；浏览器半边可 HMR。

**0.2.1**

- 修复「移动失败：HTTP 404」：浏览器半边经 HMR 已更新、而宿主半边仍停在旧版本（缺少移动路由）。移动对话框会比对宿主 `/config` 版本，不一致时提示重启；移动请求遇到 404/401 也给出同样提示。

**0.2.0**

- 新增「移动到工作区…」：任意会话可从行菜单移动到任意其他工作区；宿主用 `agents.create` 在目标 `cwd` 克隆完整历史，持久化屏障后归属目标工作区，并归档原会话（可恢复）。
- 会话菜单项占用 `sidebar.workspaces.session.menu.item`，移动选择框占用 `shell.overlay`，与已有的新建工作区对话框互不干扰。
- 移动成功后自动刷新侧栏并打开新会话；失败在对话框内提示，不会静默丢失。
- 已用隔离的 web 实例 + 真实 DSH 会话日志做端到端验证：复制的工作区计数 +1、新会话文件落盘且 header `cwd` 指向目标工作区、原会话进入归档、UI 打开新会话展示完整历史。

**0.1.2**

- 「创建」主按钮在 Endfield 主题下改成和侧栏「新会话」一样的黄底黑字（--ef-y 填充、#070a08 文字、切角、微光），不再是看不清的白底白字。
- 样式表在 HMR 重载插件行时就地刷新，不必整页刷新才能看到更新。

**0.1.1**

- 改为拦截式：不再占用 `sidebar.workspaces.directoryFlow`，修复原生目录选择器条目激活失败导致整个客户端启动报 "Failed to load plugins" 的问题。
- 对话框改由 `shell.overlay` 渲染；创建成功后调用 `workspaces.create` + `uiWorkspace.startSession`，与原生行为一致（新建工作区并开新会话）。
- 兼容 `Ctrl+Alt+O`（DSH 实际解析出来的“添加工作区”快捷键）。

**0.1.0**

- 首版：占用目录选择器座位实现命名框（已在 0.1.1 中改为拦截式）。

## License

MIT

