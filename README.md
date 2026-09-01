# ReadVerse

ReadVerse 是一款基于 Tauri 2 的本地 TXT 电子书阅读器。导入本地 TXT 文件后即可阅读，阅读位置和字号会自动保存，下次打开继续上次进度。

## 功能

- 导入本地 TXT 文件，自动识别 UTF-8、GBK 等编码
- 书架展示书名、文件大小、编码和导入时间
- 支持删除书籍
- 阅读页支持上一页 / 下一页和字号调整
- 阅读进度自动保存与恢复
- 大文件按 256KB 分块解码，避免整本载入内存

## 技术栈

- 桌面框架：Tauri 2
- 前端：React + TypeScript + Vite + Tailwind CSS
- 本地存储：SQLite（rusqlite）
- 编码检测：chardetng
- 文本解码：encoding_rs

## 环境要求

- Node.js 20 或更高版本
- Rust stable 工具链
- Windows 下需要 Visual Studio C++ Build Tools（MSVC）
- Windows WebView2 Runtime

## 安装与启动

在项目根目录执行：

```bash
npm install
```

开发模式启动桌面应用：

```bash
npm run tauri dev
```

如果只想在浏览器里查看前端页面，可以执行：

```bash
npm run dev
```

注意：浏览器模式没有 Tauri 后端能力，文件导入、书架和阅读功能需要在桌面应用里使用。

## 构建

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 测试

前端测试：

```bash
npm test
```

后端测试：

```bash
cd src-tauri
cargo test
```

## 使用说明

1. 打开应用后，点击“导入 TXT”选择本地 `.txt` 文件。
2. 导入完成后点击书架中的书籍进入阅读页。
3. 使用底部“上一页 / 下一页”按钮翻页，也可以使用键盘左右方向键或 PageUp / PageDown。
4. 阅读页顶部可以调整字号。
5. 返回书架后，再次打开同一本书会恢复到上次阅读位置和字号。

## 数据位置

书籍文件和阅读数据保存在应用数据目录：

- Windows：`%APPDATA%\com.readverse.app\`
- `books/`：导入后复制到本地的 TXT 文件
- `readverse.db`：书架元数据和阅读进度

## 项目结构

```text
ReadVerse/
├── src/                 # React 前端
│   ├── pages/           # 书架、阅读页
│   ├── lib/             # Tauri API 封装和工具函数
│   └── test/            # 测试初始化
├── src-tauri/           # Rust 后端
│   ├── src/
│   │   ├── commands.rs  # Tauri command
│   │   ├── import.rs    # 导入与编码检测
│   │   ├── reader.rs    # 分块读取与分页
│   │   └── db.rs        # SQLite 访问
│   ├── icons/           # 应用图标
│   └── tauri.conf.json
├── docs/                # 产品设计和技术方案
└── README.md
```

## 当前范围

当前为 MVP 版本，只支持 TXT 文件和亮色主题。EPUB / PDF / MOBI、章节目录、深色主题、书签、全文搜索等功能暂未实现。
