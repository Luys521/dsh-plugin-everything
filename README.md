# dsh-plugin-everything

给 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）用的 Everything 搜索插件。

Everything 在 NTFS 卷上维护一份全盘文件名索引，查询走本地 IPC。装上这个插件后，Agent 就能秒级定位全盘任意文件，不用再靠递归遍历目录去猜。

## 解决的问题

Agent 找文件时默认会 `glob` / `Get-ChildItem` / `os.walk` 递归。这个做法有两个硬伤：

- **只看得到你猜到的目录。** 猜错了就一无所获，然后得出「这个东西不存在」的错误结论。
- **慢。** 几千个文件就要扫一遍目录树。

Everything 的索引覆盖整个磁盘，毫秒级返回。搜索从「遍历猜测」变成「索引查询」。

## 提供的工具

| 工具 | 作用 |
|---|---|
| `everything_find` | 按文件名、路径、扩展名、大小、日期查找文件与文件夹 |
| `everything_content` | 搜索文件正文，经系统 IFilter 能读 Word、PDF、Excel 的文字 |
| `everything_status` | 检查索引是否可达、索引了多少条目 |

## 安装前提

1. Windows 系统
2. 安装并运行 [Everything](https://www.voidtools.com/) 1.5 或更新版本
3. 安装 ES 命令行客户端 `es.exe`

ES 通常随 Everything 一起装上。若没有，从 [voidtools 下载页](https://www.voidtools.com/downloads/) 取 `ES (Command Line Interface)`，把 `es.exe` 放到 `%LOCALAPPDATA%\Microsoft\WindowsApps\`，或安装后改配置里的 `esPath` 指向它。

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
| `ipcTimeoutMs` | `10000` | 等待索引加载的最长时间 |
| `maxResults` | `200` | 默认返回条数上限 |

改完配置需要重启 DSH 生效。工具描述是启动时读进内存的，热改文件不会重新加载。

## 排查

先跑 `everything_status`。

- 报 `Everything IPC not found`：Everything 没在运行，或者版本太旧。早期 1.5 构建（如 1.5.0.1404a）的主实例可能不创建 IPC 窗口，升级到 1.5.0.1424b 后正常。
- 索引条目数是 0：Everything 还在建索引，等一会儿。
- 想连命名实例：用 `Everything.exe -instance dsh` 启动，再把配置的 `instanceName` 设为 `dsh`。

## 已知限制

- **内容搜索要配范围。** `content:` 不建内容索引，每次都要读文件。限定 `path` 或 `extensions` 后是毫秒级；不限定的全盘检索约需数秒。限制的是耗时，不是准确性。
- **基本只索引 NTFS 卷。** FAT/exFAT 与网络路径需要在 Everything 里单独配置文件夹索引。
- **只支持 Windows。**

## 文档

详细用法、推荐搜索流程、换关键词的技巧见 [docs/DETAIL.md](docs/DETAIL.md)。

## 许可

MIT
