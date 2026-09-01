# 技术方案：TXT 电子书阅读器

## 1. 技术选型

| 层级 | 选型 | 说明 |
| --- | --- | --- |
| 桌面框架 | Tauri 2 | 安装包小、内存占用低，契合轻量定位 |
| 前端 | React + TypeScript + Vite | 生态成熟，适合做书架和阅读页交互 |
| 样式 | Tailwind CSS | 轻量、按需生成，避免引入重 UI 组件库 |
| 本地存储 | SQLite（tauri-plugin-sql） | 存储书架元数据和阅读进度 |
| 编码检测 | chardetng | Firefox 同款检测库，准确识别 UTF-8 / GBK 等编码 |
| 解码 | encoding_rs | 按块解码，支持分段读取大文件 |

相比 Electron：Electron 生态和开发效率高，但安装包通常超过 80MB、内存占用大；本产品以“轻量本地阅读器”为核心卖点，Tauri 更匹配。MVP 功能简单，Rust 侧学习成本可控。

## 2. 整体架构

采用 Tauri 经典三层结构：

- Rust Core：文件导入、编码检测与解码、分页读取、SQLite 读写
- 前端 UI：书架、阅读页、设置交互，只负责展示和用户操作
- 本地数据：书籍文件存入应用数据目录，元数据和进度存入 SQLite

前端通过 Tauri command 调用 Rust 能力，不直接访问文件系统。

## 3. 模块设计

### 3.1 导入 TXT

1. 通过 `tauri-plugin-dialog` 打开文件选择器，过滤 `.txt`
2. 读取文件头（约 64KB）交给 chardetng 检测编码
3. 将文件复制到应用数据目录，避免原文件移动或删除后失效
4. 以文件名作为书名写入 SQLite

### 3.2 书架

- 列表展示已导入书籍，字段：书名、大小、导入时间
- 支持删除书籍：删除 SQLite 记录及应用数据目录中的文件
- 空状态引导用户导入第一本书

### 3.3 阅读页

- Rust 按块读取文件，返回当前页文本与页边界信息
- 前端负责分页展示、字号调整、上一页/下一页
- 页码按字符偏移计算，不依赖固定字节位置，避免中文跨页截断

大文件策略：

- 不一次性载入整个文件，按固定字节窗口（如 256KB）读取
- 块与块之间保留重叠边界，解码后按完整行切分
- 阅读进度保存为字符偏移，恢复时从对应块开始渲染

### 3.4 阅读进度

- 翻页或离开阅读页时自动保存：书籍 ID、字符偏移、字号
- 再次打开时恢复位置和字号

## 4. 数据模型

```sql
CREATE TABLE books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  encoding TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE reading_progress (
  book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  char_offset INTEGER NOT NULL DEFAULT 0,
  font_size INTEGER NOT NULL DEFAULT 18,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## 5. 建议目录结构

```text
ReadVerse/
├── src/                 # React 前端
│   ├── pages/           # 书架、阅读页
│   ├── components/      # 通用组件
│   └── lib/             # Tauri API 封装
├── src-tauri/
│   ├── src/
│   │   ├── commands.rs  # Tauri command
│   │   ├── import.rs    # 导入与编码检测
│   │   ├── reader.rs    # 分块读取与分页
│   │   └── db.rs        # SQLite 访问
│   └── Cargo.toml
└── docs/
```

## 6. 测试策略

- Rust 单元测试：编码检测、分块解码、页边界计算、SQLite 读写
- 前端测试：书架增删、阅读进度保存与恢复
- 手工验证：GBK / UTF-8 大文件导入，断点恢复

## 7. 非 MVP 与扩展点

- 章节识别：可在导入时扫描行首标题模式，生成目录索引
- 更多格式：后续按格式扩展解析器，阅读器保持分页模型不变
- 主题：阅读设置中增加主题配置即可扩展
- 搜索与书签：基于字符偏移的索引机制可直接复用

## 8. 正式版增量设计

正式版沿用 MVP 的三层架构和字符偏移分页模型，只新增数据表、命令和前端交互，不重写现有阅读核心。

### 8.1 数据模型扩展

现有 MVP 数据表保持不变，通过 `PRAGMA user_version` 做增量迁移，新增以下表：

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  char_offset INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chapters_book_offset
  ON chapters(book_id, char_offset);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  char_offset INTEGER NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_book_offset
  ON bookmarks(book_id, char_offset);
```

迁移规则：`user_version = 0` 时只创建 MVP 表；`user_version = 1` 时创建正式版新表；后续版本继续递增。升级过程不删除、不重建已有数据。

正式版数据库迁移到 `user_version = 2`，额外增加：

- `books.format`：标记 `txt` / `epub`
- `books.cover_path`：EPUB 封面文件路径
- `reading_progress.encoding`：自动识别或手动选择的编码

书架状态迁移到 `user_version = 3`，额外增加：

- `books.is_favorite`：是否收藏
- `books.is_read`：是否标记为已读

### 8.2 新增后端模块与命令

- 章节：导入或首次打开时扫描章节标题，写入 `chapters` 表；新增 `get_chapters`
- 搜索：按解码流逐行扫描当前书籍，返回字符偏移、摘要和所属章节；新增 `search_book`
- 书签：新增 `add_bookmark`、`list_bookmarks`、`delete_bookmark`
- 设置：新增 `get_settings`、`save_settings`
- 导出：新增 `export_book`，将应用数据目录中的原文件按 TXT / EPUB 格式复制到用户选择的目标路径
- 封面：新增 `get_cover`，以 base64 data URL 返回 EPUB 封面
- EPUB：新增 `epub` 模块，负责解压、解析 OPF/spine/章节和封面，并将正文归一为纯文本
- 书架状态：新增 `set_favorite`、`set_read`、`rename_book`，只更新本地元数据
- 阅读器：为上一页和页码计算增加按需构建的页起点索引，避免每次都从文件头线性扫描

### 8.3 章节识别规则

- 行首匹配 `第 X 章 / 卷 / 回 / 话 / 节 / 部 / 篇 / 集`、`序章 / 楔子 / 引子 / 番外 / 外传 / 后记` 等常见模式
- 标题行长度限制在合理范围，避免正文长句误判
- 同一章节标题重复出现时按首次出现位置记录
- 识别结果以字符偏移保存，与阅读进度模型一致

### 8.4 EPUB 解析

- 通过 `META-INF/container.xml` 定位 OPF
- 从 OPF 解析元数据、manifest、spine 和封面资源
- 按 spine 顺序解析 XHTML，提取章节标题和正文，归一为 UTF-8 纯文本
- 生成的纯文本与章节偏移写入应用数据目录，阅读器仍使用原有字符偏移分页模型
- EPUB 原始 CSS、字体和复杂排版不进入阅读页，统一使用应用阅读样式

### 8.5 阅读器性能优化

Reader 保留原有分块解码能力，正式版增加页起点索引：

- 首次需要上一页或页码计算时，按默认页字符数扫描并缓存页起点数组
- 同一本书后续上一页、页码查询从索引二分定位，不再重复从头扫描
- 索引只存字符偏移，不缓存整页文本，内存随书字符数线性但可控
- 页字符数参数变化时重建索引，默认仍为 900 字符

## 9. 错误处理与边界情况

### 9.1 错误处理

- 所有 Tauri command 返回 `Result<T, String>`，Rust 侧将底层错误转换为可读中文消息
- 前端统一捕获 `invoke` 错误并展示为提示条，不在界面中暴露原始堆栈
- 阅读页保存进度失败时静默降级，不阻塞翻页；离开页面时仍做最后一次保存
- 导入失败时删除已复制的临时文件；数据库插入失败不残留书架记录

### 9.2 边界情况

- 空 TXT：允许导入，阅读页显示空状态
- 大文件：保持 256KB 分块读取；章节扫描和搜索逐块进行，不一次性加载全文
- 多字节编码：编码检测优先识别 BOM，chardetng 兜底；解码器跨块保留状态，避免中文字符截断
- 编码采样截断：UTF-8 采样末尾出现不完整多字节字符时仍按 UTF-8 处理，避免误判为 GBK
- 编码候选顺序：UTF-8 → GBK → GB2312 → Big5 → windows-1252，windows-1252 仅作为最后兜底
- 编码校验：多段采样解码后统计替换字符，出现大量 `�` 时自动尝试下一候选编码
- 编码手动切换：阅读页切换编码后实时重读并持久化，书架标签同步展示
- 文件缺失或损坏：阅读页显示可读错误，返回书架后仍可继续管理其他书籍
- 删除失败：删除记录后尝试清理文件；文件删除失败不影响书架记录删除，并在日志或返回结果中体现
- 重复导入：书架前端按书名查重，重复书名提示并跳过
- 同名书籍多本：阅读进度、目录、书签均按书籍 ID 隔离
- 导出：目标文件已存在时由系统保存对话框确认覆盖；源文件缺失时阻止导出并提示

## 10. 打包发布流程

1. 升级版本号到 `1.0.0`（`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`）
2. 执行 `npm test` 和 `cargo test`，确认前后端测试全部通过
3. 执行 `npm run tauri build`
4. 检查 `src-tauri/target/release/bundle/` 下 MSI / NSIS 安装包
5. 在干净 Windows 环境安装，验证 WebView2、应用数据目录、MVP 旧数据迁移
6. 验证导入、书架、阅读、目录、书签、搜索、主题切换和进度恢复
7. 如有代码签名证书，对安装包签名后发布

## 11. 已知风险

- 分页基于固定字符数和行边界，而非浏览器视口像素；字号、窗口宽度变化后页码为近似值。正式版用章节和百分比进度辅助导航，不做视口精确分页重构
- 章节识别依赖常见标题模式，个别非标准书名或正文行可能误判或漏判，不影响阅读
- 全文搜索采用逐块扫描，超大型文件搜索可能有延迟；结果数量设置上限
- Windows 未签名安装包可能触发 SmartScreen；如无证书需在发布说明中提示
- 应用数据目录损坏或磁盘写入失败时，错误提示和恢复路径依赖 SQLite 检查，极端情况下需要用户手动清理数据目录
