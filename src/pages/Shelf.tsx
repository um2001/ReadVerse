import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  BookOpen,
  CheckCircle2,
  Download,
  FileWarning,
  Heart,
  MoreVertical,
  Pencil,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  deleteBook,
  exportBook,
  getCover,
  importBook,
  listBooks,
  renameBook,
  setFavorite,
  setReadStatus,
} from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";
import { SettingsPanel } from "../components/SettingsPanel";
import type { Book, Settings } from "../types";

interface ShelfProps {
  onOpen: (book: Book) => void;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
}

type SortMode = "recent" | "created" | "title" | "progress";
type ShelfView = "home" | "library";

function fileStem(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  const name = parts[parts.length - 1] ?? "";
  return name.replace(/\.(txt|epub)$/i, "") || "未命名书籍";
}

function coverColor(title: string): string {
  const palette = ["#0e7c6d", "#9a5f2f", "#4b6a8f", "#7d5a8c", "#8a5a3b"];
  let hash = 0;
  for (const char of title) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

export function Shelf({ onOpen, settings, onSettingsChange }: ShelfProps) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [covers, setCovers] = useState<Record<number, string>>({});
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [view, setView] = useState<ShelfView>("home");
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [renamingBook, setRenamingBook] = useState<Book | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setBooks(await listBooks());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    async function loadCovers() {
      const next: Record<number, string> = {};
      await Promise.all(
        books
          .filter((book) => book.format === "epub" && book.cover_path)
          .map(async (book) => {
            try {
              const cover = await getCover(book.id);
              if (cover) next[book.id] = cover;
            } catch {
              // 封面加载失败不影响书架使用
            }
          }),
      );
      if (!cancelled) setCovers(next);
    }
    void loadCovers();
    return () => {
      cancelled = true;
    };
  }, [books]);

  useEffect(() => {
    if (openMenuId === null) return;
    function closeMenu() {
      setOpenMenuId(null);
    }
    window.addEventListener("pointerdown", closeMenu);
    return () => window.removeEventListener("pointerdown", closeMenu);
  }, [openMenuId]);

  async function handleImport() {
    setImporting(true);
    setError("");
    setNotice("");
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "TXT / EPUB 电子书",
            extensions: ["txt", "epub"],
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const seen = new Set(books.map((book) => book.title.toLowerCase()));
      let importedCount = 0;
      let duplicateCount = 0;
      const failures: string[] = [];

      for (const path of paths) {
        const stem = fileStem(path);
        const key = stem.toLowerCase();
        if (seen.has(key)) {
          duplicateCount += 1;
          continue;
        }
        try {
          await importBook(path);
          seen.add(key);
          importedCount += 1;
        } catch (err) {
          failures.push(`${stem}：${String(err)}`);
        }
      }

      await refresh();
      const parts = [
        importedCount > 0 ? `成功导入 ${importedCount} 本` : "",
        duplicateCount > 0 ? `跳过 ${duplicateCount} 本重复书名` : "",
        ...failures,
      ].filter(Boolean);
      if (parts.length > 0) setNotice(parts.join("；"));
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  }

  function replaceBook(updated: Book) {
    setBooks((current) =>
      current.map((book) => (book.id === updated.id ? updated : book)),
    );
  }

  async function handleDelete(book: Book) {
    if (!window.confirm(`确定删除《${book.title}》吗？`)) return;
    try {
      await deleteBook(book.id);
      setBooks((current) => current.filter((item) => item.id !== book.id));
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleExport(book: Book) {
    try {
      const isEpub = book.format === "epub";
      const destination = await save({
        defaultPath: `${book.title}.${isEpub ? "epub" : "txt"}`,
        filters: [
          {
            name: isEpub ? "EPUB 电子书" : "TXT 电子书",
            extensions: [isEpub ? "epub" : "txt"],
          },
        ],
      });
      if (typeof destination !== "string") return;
      await exportBook(book.id, destination);
      setNotice(`《${book.title}》导出成功`);
      window.setTimeout(() => setNotice(""), 3000);
    } catch (err) {
      setError(String(err));
    }
  }

  async function toggleFavorite(book: Book) {
    try {
      const updated = await setFavorite(book.id, !book.is_favorite);
      replaceBook(updated);
      setNotice(updated.is_favorite ? "已加入藏书馆" : "已取消收藏");
      window.setTimeout(() => setNotice(""), 3000);
    } catch (err) {
      setError(String(err));
    }
  }

  async function toggleRead(book: Book) {
    try {
      const updated = await setReadStatus(book.id, !book.is_read);
      replaceBook(updated);
    } catch (err) {
      setError(String(err));
    }
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!renamingBook || !renameValue.trim()) return;
    try {
      const updated = await renameBook(renamingBook.id, renameValue);
      replaceBook(updated);
      setRenamingBook(null);
      setNotice("书名已更新");
      window.setTimeout(() => setNotice(""), 3000);
    } catch (err) {
      setError(String(err));
    }
  }

  const favoriteCount = books.filter((book) => book.is_favorite).length;
  const visibleBooks = useMemo(() => {
    const baseBooks = view === "library" ? books.filter((book) => book.is_favorite) : books;
    const filtered = query.trim()
      ? baseBooks.filter((book) =>
          book.title.toLowerCase().includes(query.trim().toLowerCase()),
        )
      : baseBooks;
    return [...filtered].sort((a, b) => {
      if (sort === "title") {
        return a.title.localeCompare(b.title, "zh-CN");
      }
      if (sort === "progress") {
        const pa = a.char_count > 0 ? a.last_char_offset / a.char_count : 0;
        const pb = b.char_count > 0 ? b.last_char_offset / b.char_count : 0;
        return pb - pa || b.created_at.localeCompare(a.created_at);
      }
      if (sort === "created") {
        return b.created_at.localeCompare(a.created_at);
      }
      const ra = a.last_read_at || a.created_at;
      const rb = b.last_read_at || b.created_at;
      return rb.localeCompare(ra);
    });
  }, [books, query, sort, view]);

  return (
    <div className="min-h-full bg-[var(--bg)] text-[var(--text)]">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-white shadow-sm">
            <BookOpen className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-5 text-[var(--text)]">
              ReadVerse
            </h1>
            <p className="text-xs text-[var(--muted)]">本地 TXT / EPUB 阅读器</p>
          </div>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            title="阅读设置"
            className="icon-button ml-auto"
          >
            <Settings2 className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={importing}
            className="primary-button"
          >
            <Upload className="h-4 w-4" aria-hidden />
            {importing ? "正在导入…" : "导入电子书"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
            <button
              type="button"
              onClick={() => setView("home")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                view === "home"
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              首页
            </button>
            <button
              type="button"
              onClick={() => setView("library")}
              className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                view === "library"
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              <Heart
                className={`h-3.5 w-3.5 ${
                  favoriteCount > 0 ? "fill-current text-[var(--accent)]" : ""
                }`}
                aria-hidden
              />
              藏书馆
              <span className="text-xs opacity-70">{favoriteCount}</span>
            </button>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
                aria-hidden
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索书名"
                className="h-9 w-56 rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              aria-label="排序方式"
            >
              <option value="recent">最近阅读</option>
              <option value="created">最近导入</option>
              <option value="progress">阅读进度</option>
              <option value="title">书名</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-4 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent-strong)]">
            {notice}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-sm text-[var(--muted)]">
            正在加载书架…
          </div>
        ) : visibleBooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-[var(--border)] bg-[var(--surface-soft)] px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
              {view === "library" ? (
                <Heart className="h-7 w-7" aria-hidden />
              ) : (
                <BookOpen className="h-7 w-7" aria-hidden />
              )}
            </div>
            <h3 className="text-base font-medium text-[var(--text)]">
              {query.trim()
                ? "没有找到匹配的书籍"
                : view === "library"
                  ? "藏书馆还是空的"
                  : "书架还是空的"}
            </h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
              {query.trim()
                ? "换个书名关键词试试，或清空搜索条件。"
                : view === "library"
                  ? "在首页书籍的三点菜单中点击“收藏”，书籍会出现在这里。"
                  : "导入一本本地 TXT 或 EPUB 电子书，阅读位置会自动保存。"}
            </p>
            {!query.trim() && (
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={importing}
                className="primary-button mt-5"
              >
                <Upload className="h-4 w-4" aria-hidden />
                导入电子书
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {visibleBooks.map((book) => {
              const percent =
                book.char_count > 0
                  ? Math.min(
                      100,
                      Math.round((book.last_char_offset / book.char_count) * 100),
                    )
                  : 0;
              return (
                <li
                  key={book.id}
                  className="group relative flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-lg"
                >
                  <button
                    type="button"
                    onClick={() => onOpen(book)}
                    className="flex min-w-0 flex-1 items-center gap-4 text-left"
                  >
                    <span
                      className="relative flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg text-lg font-semibold text-white shadow-sm"
                      style={
                        book.format === "epub" && covers[book.id]
                          ? { background: "transparent" }
                          : { background: coverColor(book.title) }
                      }
                    >
                      {book.format === "epub" && covers[book.id] ? (
                        <img
                          src={covers[book.id]}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span aria-hidden>{book.title.slice(0, 1)}</span>
                      )}
                      {book.is_read && (
                        <span className="absolute bottom-1 right-1 rounded bg-[var(--accent)] px-1 py-0.5 text-[10px] font-medium text-white">
                          已读
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-[var(--text)]">
                          {book.title}
                        </span>
                        {book.is_favorite && (
                          <Heart
                            className="h-3.5 w-3.5 shrink-0 fill-current text-[var(--accent)]"
                            aria-label="已收藏"
                          />
                        )}
                        {book.is_read && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs text-[var(--accent)]">
                            <CheckCircle2 className="h-3 w-3" aria-hidden />
                            已读
                          </span>
                        )}
                        {book.missing && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-xs text-[var(--danger)]">
                            <FileWarning className="h-3 w-3" aria-hidden />
                            文件缺失
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--muted)]">
                        {formatBytes(book.file_size)} ·{" "}
                        {book.format.toUpperCase()} · {book.encoding} ·{" "}
                        {formatDate(book.created_at)}
                      </span>
                      <span className="mt-2 block">
                        <span className="mb-1 flex items-center justify-between text-xs text-[var(--muted)]">
                          <span>
                            {book.last_read_at
                              ? `上次读到 ${formatDate(book.last_read_at)}`
                              : "尚未开始阅读"}
                          </span>
                          <span>{percent}%</span>
                        </span>
                        <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-soft)]">
                          <span
                            className="block h-full rounded-full bg-[var(--accent)] transition-all"
                            style={{ width: `${percent}%` }}
                          />
                        </span>
                      </span>
                    </span>
                  </button>

                  <div className="absolute right-3 top-3 z-20">
                    <button
                      type="button"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenMenuId((current) =>
                          current === book.id ? null : book.id,
                        );
                      }}
                      title="更多操作"
                      className="icon-button h-8 w-8"
                    >
                      <MoreVertical className="h-4 w-4" aria-hidden />
                    </button>
                    {openMenuId === book.id && (
                      <div
                        className="absolute right-0 top-10 z-30 w-48 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => void handleExport(book)}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-soft)]"
                        >
                          <Download className="h-4 w-4" aria-hidden />
                          导出书籍
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleFavorite(book)}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-soft)]"
                        >
                          <Heart
                            className={`h-4 w-4 ${
                              book.is_favorite
                                ? "fill-current text-[var(--accent)]"
                                : ""
                            }`}
                            aria-hidden
                          />
                          {book.is_favorite ? "取消收藏" : "收藏"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleRead(book)}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-soft)]"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden />
                          {book.is_read ? "标记未读" : "标记已读"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingBook(book);
                            setRenameValue(book.title);
                            setOpenMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-soft)]"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                          重命名书籍
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(book)}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                          删除书籍
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {showSettings && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--text)]">
                阅读设置
              </h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                title="关闭"
                className="icon-button"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <SettingsPanel settings={settings} onChange={onSettingsChange} />
          </div>
        </div>
      )}

      {renamingBook && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setRenamingBook(null)}
        >
          <form
            className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => void submitRename(event)}
          >
            <h2 className="mb-4 text-base font-semibold text-[var(--text)]">
              重命名书籍
            </h2>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              placeholder="输入新的显示名称"
              className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenamingBook(null)}
                className="text-button"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!renameValue.trim()}
                className="primary-button"
              >
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
