# dsh-plugin-everything

[English](README.md) | 中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的 Everything 全盘文件搜索插件。

Everything 在 NTFS 卷上维护一份全盘文件名索引，查询走本地 IPC。装上这个插件，Agent 就能毫秒级定位全盘任意文件，不必再靠递归遍历目录去猜。

## 解决的问题

Agent 找文件时默认会 `glob` / `Get-ChildItem` / `os.walk` 递归。这个做法有两个硬伤：

- **只看得到你猜到的目录。** 猜错了就一无所获，然后得出「这个东西不存在」的错误结论。
- **慢。** 几千个文件就要扫一遍目录树。

Everything 的索引覆盖整个磁盘，毫秒级返回。搜索从「遍历猜测」变成「索引查询」。

## 工具

| 工具 | 作用 | 何时用 |
|---|---|---|
| `everything_find` | 按文件名、路径、扩展名、大小、日期、属性查找文件与文件夹 | 需要定位某个文件时优先用它，不要递归目录 |
| `everything_content` | 搜索文件正文；经系统 IFilter 可读 Word、PDF、Excel 的文字，无对应 IFilter 则按纯文本兜底 | 需要知道「哪个文件里有这个词」，不关心行号 |
| `everything_status` | 检查索引是否可达、索引了多少条目 | 前两个工具报错时先跑它 |

`everything_content` 只回答「哪个文件包含」，不返回行号；需要匹配的具体行，仍要用 `grep` 或 `read`。

## 安装

**前提**：Windows 系统；已安装并运行 [Everything](https://www.voidtools.com/) 1.5 或更新版本。

1. 安装 ES 命令行工具。Everything 本体**不含**它：

   从 [voidtools/ES Releases](https://github.com/voidtools/ES/releases) 下载，把 `es.exe` 解压到 `%LOCALAPPDATA%\Microsoft\WindowsApps`（该目录在 `PATH` 中，可直接按名字调用）。装在别处则需在配置里改 `esPath`。

2. 安装插件：

   ```sh
   dsh plugin --profile web add github:Luys521/dsh-plugin-everything
   ```

3. 重启 `dsh web` 生效。工具描述在启动时读入内存，热改配置不会重新加载。

## 配置

在 DSH 的 `cordis.patch.yml` 里加：

```yaml
- insert:
    - id: everything-search
      name: 'dsh-plugin-everything'
      config:
        instanceName: ''
```

| 键 | 默认 | 说明 |
|---|---|---|
| `esPath` | `%LOCALAPPDATA%\Microsoft\WindowsApps\es.exe` | ES 可执行文件路径 |
| `instanceName` | 空（连默认实例） | Everything 命名实例名 |
| `ipcTimeoutMs` | `10000` | 等待索引加载的最长时间（毫秒） |
| `maxResults` | `200` | 默认返回条数上限 |

### 内容索引（Everything 侧，可选）

这一项设的不是插件，而是 Everything 自己。默认关闭时 `content:` 逐文件实时读取，慢但全；开启后正文常驻内存、查询变快，但**只覆盖索引范围**。

打开 Everything → **工具 → 选项 → 高级**，在「显示设置包含」里输入 `content`，改这三个：

| 设置名 | 作用 |
|---|---|
| `content_indexing_enabled` | 总开关，设 `true` 才启用内容索引 |
| `content_indexing_include_only_folders` | 只索引这些目录，留空为不限 |
| `content_indexing_include_only_files` | 只索引这些类型；**默认 `*.doc;*.docx;*.pdf;*.txt;*.xls;*.xlsx`**，要搜 `.md`／`.csv`／`.pptx` 就把通配符追加进这个分号列表 |

需要搜 `.xml` 之类不在这张表里的类型，也可以不动索引，改用 `es.exe` 直接配 `notindexed:content:...` 强制实时扫描——代价是退回慢速路径。快与全，只能选一个。

> 少数 1.5 早期构建（如 1.5.0.1391a）左侧有独立的「内容」页。官方选项文档列出的页签只有 常规 / 历史 / 索引 / 插件 / 高级，找不到「内容」页时按上面的设置名搜索即可。

## 工作原理

- 每次查询都以子进程调用 `es.exe`，结果用 `-export-json` 写入临时文件再读回。ES 的 stdout 走控制台代码页，非 ASCII 路径会被破坏；走 JSON 导出可以保住每个字符。
- 临时目录一查询一份，用完即删。

## 排查

先跑 `everything_status`。

- 报 `Everything IPC not found`：Everything 没在运行，或者版本太旧。早期 1.5 构建（如 1.5.0.1404a）的主实例可能不创建 IPC 窗口，升级到 1.5.0.1424b 后正常。
- 报 `ES not found` / `spawn ... ENOENT`：`es.exe` 不在默认路径。按「安装」第 1 步放到位，或改配置里的 `esPath`。
- 索引条目数是 0：Everything 还在建索引，等一会儿。
- 想连命名实例：用 `Everything.exe -instance dsh` 启动，再把配置的 `instanceName` 设为 `dsh`。

## 已知限制

- **内容搜索要配范围。** `content:` 不建内容索引，每次都要读文件。限定 `path` 或 `extensions` 后是毫秒级；不限定的全盘检索约需数秒。限制的是耗时，不是准确性。
- **开了内容索引，`content:` 只搜索引范围。** 索引开启后只覆盖 include-only 的文件夹与类型（默认 `*.doc;*.docx;*.pdf;*.txt;*.xls;*.xlsx`），本插件搜索引外类型（`.md`、`.csv`、`.pptx`）会**返回空而不报错**。改法与取舍见上面「配置 → 内容索引」。
- **扫描件 PDF 搜不到。** 内容搜索依赖文本层；图片型 PDF 没有可提取的文字，不先做 OCR 就搜不出，与索引设不设置无关。
- **正则走 `regex:` 修饰符。** 插件内部统一拼成 `-search 'regex:...'`；直接调 `es.exe` 时不要用 `-regex` 开关，它与其它语法组合时行为不一致。
- **基本只索引 NTFS 卷。** FAT/exFAT 与网络路径需要在 Everything 里单独配置文件夹索引。
- **只支持 Windows。**
- **索引范围取决于 Everything 的排除设置。** 插件不做过滤；对结果有疑问时先跑 `everything_status` 确认可达与条目数。

## 兼容性

需要宿主提供 `@deepseek-ai/dsh-tools`，插件的 peer 范围是 `^0.0.1-rc.1 || ^0.1.5-rc.2`：

- `0.1.5-rc.2` —— 本机实测，三个工具的 `defineTool` 定义、`register` 签名、输出 schema 全部被接受；
- `0.0.1-rc.1` —— npm 上 `latest` 指向的版本，`npm i @deepseek-ai/dsh-tools` 默认拿到的就是它。

为什么是枚举而不是单一范围：semver 规定**预发布版本只能被含同一 `major.minor.patch` 预发布号的范围满足**，所以 `^0.1.5-rc.2` 覆盖不到 `0.2.x`，每条已验证的宿主线都得单列。

`npm run check:peers` 会解析 registry 的 dist-tags 校验：`latest` 落在范围外直接失败，`next` / `alpha` 只告警——未验证的线不冒充支持。CI 每次推送都跑。

## 依赖与致谢

本插件不含任何 Everything 的代码或二进制，运行期只调用本机已安装的 Everything 与 `es.exe`。

| 组件 | 提供方 | 与本项目的关系 |
|---|---|---|
| Everything（NTFS 全盘索引客户端） | [voidtools](https://www.voidtools.com/) | 本插件经其 IPC 查询索引。免费但闭源，不随本仓库分发 |
| ES 命令行 `es.exe` | [voidtools/ES](https://github.com/voidtools/ES) | 本插件以子进程调用，解析其 `-export-json` 结果。不随本仓库分发 |

- Everything 与 ES 的著作权归 voidtools（作者 David Carpenter）所有。
- 本项目与 voidtools 无从属、赞助或背书关系。「Everything」为 voidtools 的产品名，此处仅作指称。
- 本仓库的 MIT 许可仅覆盖本仓库内的代码，不延伸至 Everything 或 ES。
- 若这个插件省了你的时间，索引本身是别人做的——可以去 [给 Everything 作者捐款](https://www.voidtools.com/donate/)。

## 文档

[docs/DETAIL.md](docs/DETAIL.md) 是本插件随工具一起呈现给 DSH 的说明书，讲这份 README 没展开的部分：

- 三步检索流程：`everything_find` 定位 → `read` / `grep` 读 → 从读到的内容反查其他文件；
- 为什么类名常常搜不到、而数据结构名能命中——在断定「不存在」之前值得先读；
- 空结果怎么表述才负责：把检索范围和命中数一起写出来，「不在这个目录」不等于「哪里都没有」。

## 开发

```sh
npm install
npm run check        # 语法 + 清单 + peer 范围
npm run check:peers  # 只校验 peer 范围是否覆盖 registry 上的 latest / next
```

插件没有构建步骤：`index.js` 就是发布产物，直接由 DSH 以 ESM 加载。

## 许可

MIT，详见 [LICENSE](LICENSE)。
