# 技术方案：TXT 电子书阅读器（MVP）

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
