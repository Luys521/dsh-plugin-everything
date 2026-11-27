# Everything 搜索

给 Agent 提供三个基于 Everything 索引的搜索工具。Everything 在 NTFS 卷上维护一份全盘文件名索引，查询走 IPC，不需要遍历目录，因此在几百万条目上也能毫秒返回。

## 工具

| 工具 | 作用 |
|---|---|
| `everything_find` | 按文件名 / 路径查找文件与文件夹 |
| `everything_content` | 搜索文件正文，经系统 IFilter 也能读 Word、PDF 的文字 |
| `everything_status` | 检查索引是否可达、索引了多少条目 |

## 什么时候用哪个

| 需求 | 工具 |
|---|---|
| 找文件名或路径 | `everything_find` |
| 找文件里**有没有**某个词（不关心行内容） | `everything_content` |
| 找文件里的**具体行** | `grep` |
| 读整个文件 | `read` |

- **定位文件一律用 `everything_find`**，不要用 `glob`、`Get-ChildItem`、`os.walk` 或任何目录递归去找文件。递归只能看到你已经猜到的目录，而且慢。
- **`everything_content` 只回答「哪个文件里有」，不返回行号。** 需要行内容还是要 `grep`。
- **`everything_content` 能读 docx / pdf / xlsx 的内部文字**，纯文本搜索工具读不了这些容器格式，搜配表时用它。

## 推荐流程

```
第 1 步  everything_find     定位候选文件（全盘，毫秒级）
第 2 步  read / grep         读具体内容
第 3 步  关联搜索             从读到的名字反查其他文件
```

第 3 步最关键，也最容易漏。实际教训：找一个类 `CFooLogic` 的旧版源码，搜 `CFooLogic` 一无所获；换词搜 `Foo*` 才命中 `FOODB.H`，里面正是完整的数据结构定义。**「搜不到」只是「这几个名字搜不到」，不是「不存在」。**

## 换关键词，不要只搜类名

同一个概念在不同文件里命名不同。类名往往是新版本才有的，旧版可能叫别的；但**数据结构和枚举常沿用旧名**。

| 只搜这个会漏 | 还要搜这些 |
|---|---|
| 类名 `CFooLogic` | 关键字 `Foo`、结构名 `TFooStruct` |
| 类名 `CItemList` | 关键字 `Item`、结构名 `PlayerItem` |
| 类名 | 该类的**数据结构名** |
| 类名 | 该类的**枚举名** |

要判「不存在」，至少换三组叫法（正式类名 / 数据结构名 / 业务中文词）各搜一遍。

## 「不存在」的结论范围要写进句子

`everything_find` 返回空结果是有意义的证据，但结论必须带上范围：

```
✗ 错：没有这个文件
✓ 对：全盘搜 CFooLogic* 命中 4 个结果，全在临时产物与回收目录下，没有源码副本
✓ 对：在 notes 目录下搜 *.spr 命中 0 个
```

带了 `path` 就只能说「不在这个目录下」，只有全盘搜过才能说「不在任何地方」。**把检索范围和命中数一起写进结论。**

## 用法示例

```
everything_find      query="*.md" path="<工作区目录>" limit=20
everything_find      query="dm:today *.pdf"          # 今天改过的 PDF
everything_find      query="size:>1gb" sort="-size"  # 最大的文件
everything_find      query="^IMG_\d+" regex=true
everything_content   query="客户端架构" path="<工作区目录>" extensions="docx;pdf"
```

## 使用前提

1. 本机安装并运行 Everything 1.5（实测 1.5.0.1424b）。
2. 安装 ES 命令行客户端 `es.exe`，默认位置 `%LOCALAPPDATA%\Microsoft\WindowsApps\es.exe`。

插件默认连接**默认实例**，即随系统自启动的那个 Everything，无需额外启动命名实例。

早期 1.5 构建（如 1.5.0.1404a）的主实例可能不创建 IPC 窗口，`es.exe` 会报 `Error 8: Everything IPC not found`；升级到 1.5.0.1424b 后实测正常。若仍遇到，可改配置连一个命名实例：

```
"C:\Program Files\Everything\Everything.exe" -instance dsh
```

并在配置里把 `instanceName` 设为 `dsh`。

## 已知限制

- **内容搜索要配范围。** `content:` 不建内容索引，每次都要读文件。限定 `path` 或 `extensions` 后是毫秒级；不限定的全盘检索要数秒（实测约 4 秒）。限制的是**耗时**，不是准确性。
- **正则写法特殊。** 插件内部统一用 `-search 'regex:...'` 形式，直接调 `es.exe` 时不要用 `-regex` 开关——它与其它语法组合时行为不一致。
- **基本只索引 NTFS 卷。** FAT/exFAT 与网络路径需要在 Everything 里单独配置文件夹索引后才可检索。
- **索引范围取决于 Everything 的排除设置。** 某些目录是否可检索由用户在 Everything 里配置决定，插件不做过滤；对结果有疑问时先跑 `everything_status` 确认索引可达与条目数。

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `esPath` | `%LOCALAPPDATA%\Microsoft\WindowsApps\es.exe` | ES 可执行文件路径 |
| `instanceName` | 空（连默认实例） | Everything 命名实例名，留空即连随系统启动的主实例 |
| `ipcTimeoutMs` | `10000` | 等待索引加载的最长时间 |
| `maxResults` | `200` | 默认返回条数上限 |
