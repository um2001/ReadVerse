# ReadVerse

ReadVerse 是一款基于 Tauri 2 的本地 TXT / EPUB 电子书阅读器。导入本地电子书后即可阅读，阅读位置、字号、主题和排版设置会自动保存，下次打开继续上次进度。

## 功能

- 导入本地 TXT 文件，自动识别 UTF-8、GBK 等编码
- 支持导入 EPUB，自动解析章节和封面
- 支持一次导入多个 TXT / EPUB 文件，重复书名自动跳过
- 支持按原格式导出 TXT / EPUB 书籍
- 书架支持搜索、排序、阅读进度和最近阅读展示
- 每本书提供三点菜单：导出、删除、收藏、标记已读、重命名
- 收藏书籍进入藏书馆，首页书架仍然保留显示
- 已标记读完的书籍进入“已读完”页签
- 已读书籍在封面和标题旁显示状态标签
- 收藏、已读、重命名状态本地持久化保存
- 支持删除书籍
- 自动识别章节目录并支持目录跳转
- 阅读页可手动切换 UTF-8 / GBK / GB2312 编码，解决自动识别失败的乱码
- 支持书签添加、跳转和删除
- 支持当前书籍全文搜索
- 亮色、护眼、夜间 3 套阅读主题
- 支持字号、正文字体和行距调整
- 书架首页可直接打开阅读设置
- 阅读页支持上一页 / 下一页、进度条和按百分比跳转
- 阅读进度自动保存与恢复
- 大文件按 256KB 分块解码，避免整本载入内存

## 技术栈

- 桌面框架：Tauri 2
- 前端：React + TypeScript + Vite + Tailwind CSS
- 图标：lucide-react
- 本地存储：SQLite（rusqlite）
- 编码检测：chardetng
- 文本解码：encoding_rs
- EPUB 解析：zip + quick-xml
- 封面数据：base64
- 测试：Vitest + Testing Library、Rust 单元测试

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

1. 打开应用后，点击“导入电子书”选择一个或多个本地 `.txt` / `.epub` 文件。
2. 导入完成后点击书架中的书籍进入阅读页。
3. 使用底部“上一页 / 下一页”按钮翻页，也可以使用键盘左右方向键或 PageUp / PageDown。
4. 阅读页顶部可以打开目录、书签、搜索和阅读设置。
5. 返回书架后，再次打开同一本书会恢复到上次阅读位置和字号。

## 数据位置

书籍文件和阅读数据保存在应用数据目录：

- Windows：`%APPDATA%\com.readverse.app\`
- `books/`：TXT 原文件，以及 EPUB 解压后的正文、原文件和封面
- `readverse.db`：书架、阅读进度、目录、书签和应用设置

## 项目结构

```text
ReadVerse/
├── index.html                     # Vite 前端入口 HTML
├── src/                           # React + TypeScript 前端
│   ├── components/                # 可复用 UI 组件
│   │   └── SettingsPanel.tsx      # 主题、字体、行距设置面板，书架和阅读页共用
│   ├── pages/                     # 页面级组件
│   │   ├── Shelf.tsx              # 书架：首页 / 藏书馆 / 已读完、搜索、排序、三点菜单、重命名弹窗
│   │   ├── Shelf.test.tsx         # 书架交互测试
│   │   ├── Reader.tsx             # 阅读页：翻页、目录、书签、搜索、编码切换、进度条
│   │   └── Reader.test.tsx        # 阅读页交互测试
│   ├── lib/                       # 前端工具层
│   │   ├── api.ts                 # 所有 Tauri invoke 封装，前端调用 Rust 命令的唯一入口
│   │   ├── format.ts              # 文件大小、日期、数值范围工具
│   │   └── format.test.ts         # 工具函数测试
│   ├── test/                      # 测试初始化
│   │   └── setup.ts               # Testing Library cleanup 等全局配置
│   ├── App.tsx                    # 根组件：加载全局设置，切换书架 / 阅读页
│   ├── index.css                  # 全局样式与亮色 / 护眼 / 夜间主题变量
│   ├── main.tsx                   # React 渲染入口
│   ├── types.ts                   # Book、Chapter、Bookmark、Settings 等类型定义
│   └── vite-env.d.ts              # Vite 类型声明
├── src-tauri/                     # Rust 后端
│   ├── src/
│   │   ├── main.rs                # 程序二进制入口
│   │   ├── lib.rs                 # Tauri 应用装配，注册全部 commands
│   │   ├── commands.rs            # 对外命令：导入、导出、书架状态、进度、阅读、目录、书签、搜索
│   │   ├── import.rs              # TXT 导入、编码检测、文件复制与导出
│   │   ├── epub.rs                # EPUB 解压、OPF/spine/章节解析、封面提取、文本归一
│   │   ├── reader.rs              # 分块解码、分页、页起点索引、章节扫描、全文搜索
│   │   └── db.rs                  # SQLite 建表、迁移、书架 / 进度 / 书签 / 设置 / 收藏 / 已读读写
│   ├── capabilities/              # Tauri v2 窗口权限配置（core、dialog）
│   ├── icons/                     # 应用图标
│   ├── build.rs                   # Tauri 构建脚本
│   ├── Cargo.lock                 # Rust 依赖锁文件，由 cargo 维护
│   ├── Cargo.toml                 # Rust 依赖：SQLite、编码检测、EPUB 解析等
│   └── tauri.conf.json            # 窗口、打包、应用名称等全局配置
├── docs/                          # 产品设计和技术方案文档
├── package.json                   # npm 脚本与前端依赖
├── package-lock.json              # npm 依赖锁文件
├── tsconfig.json                  # TypeScript 配置
├── vite.config.ts                 # Vite / Vitest 配置
└── README.md
```

## 架构说明

前端不直接读取文件或数据库，所有文件导入、编码识别、EPUB 解析、分页读取、进度和书架状态都通过 `src/lib/api.ts` 调用 Rust 后端命令完成。

- `App.tsx` 没有使用独立路由库，通过 React 状态在书架和阅读页之间切换。
- 书架首页、藏书馆、已读完是 `Shelf.tsx` 内的三个视图，不是三个独立页面。
- 三点菜单、书籍卡片目前内联在 `Shelf.tsx` 中；只有设置面板抽成了 `SettingsPanel.tsx` 通用组件。
- 阅读页的目录、书签、搜索和设置使用同一个右侧面板，通过 `panel` 状态切换。
- SQLite 使用 `PRAGMA user_version` 做增量迁移，升级正式版不会重建已有数据。

## 当前范围

正式版为 1.0.0，专注本地 TXT / EPUB 阅读。PDF / MOBI、云同步、账号体系、批注划线等功能暂未实现。
