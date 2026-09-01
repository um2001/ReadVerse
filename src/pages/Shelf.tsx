import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  FileWarning,
  LibraryBig,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { deleteBook, importBook, listBooks } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";
import type { Book } from "../types";

interface ShelfProps {
  onOpen: (book: Book) => void;
}

type SortMode = "recent" | "created" | "title" | "progress";

function fileStem(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  const name = parts[parts.length - 1] ?? "";
  return name.replace(/\.txt$/i, "") || "未命名书籍";
}

function coverColor(title: string): string {
  const palette = ["#0e7c6d", "#9a5f2f", "#4b6a8f", "#7d5a8c", "#8a5a3b"];
  let hash = 0;
  for (const char of title) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

export function Shelf({ onOpen }: ShelfProps) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");

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

  async function handleImport() {
    setImporting(true);
    setError("");
    setNotice("");
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "TXT 电子书", extensions: ["txt"] }],
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

  async function handleDelete(book: Book) {
    if (!window.confirm(`确定删除《${book.title}》吗？`)) return;
    try {
      await deleteBook(book.id);
      setBooks((current) => current.filter((item) => item.id !== book.id));
    } catch (err) {
      setError(String(err));
    }
  }

  const visibleBooks = useMemo(() => {
    const filtered = query.trim()
      ? books.filter((book) =>
          book.title.toLowerCase().includes(query.trim().toLowerCase()),
        )
      : books;
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
  }, [books, query, sort]);

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
            <p className="text-xs text-[var(--muted)]">本地 TXT 阅读器</p>
          </div>
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={importing}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload className="h-4 w-4" aria-hidden />
            {importing ? "正在导入…" : "导入 TXT"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-[var(--text)]">
            <LibraryBig className="h-4 w-4" aria-hidden />
            <h2 className="text-sm font-semibold">我的书架</h2>
            {!loading && (
              <span className="text-xs text-[var(--muted)]">
                {visibleBooks.length} 本
              </span>
            )}
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
              <BookOpen className="h-7 w-7" aria-hidden />
            </div>
            <h3 className="text-base font-medium text-[var(--text)]">
              {query.trim() ? "没有找到匹配的书籍" : "书架还是空的"}
            </h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
              {query.trim()
                ? "换个书名关键词试试，或清空搜索条件。"
                : "导入一本本地 TXT 电子书，阅读位置会自动保存。"}
            </p>
            {!query.trim() && (
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={importing}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
              >
                <Upload className="h-4 w-4" aria-hidden />
                导入第一本书
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
                  className="group flex items-center gap-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-lg"
                >
                  <button
                    type="button"
                    onClick={() => onOpen(book)}
                    className="flex min-w-0 flex-1 items-center gap-4 text-left"
                  >
                    <span
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-lg font-semibold text-white shadow-sm"
                      style={{ background: coverColor(book.title) }}
                      aria-hidden
                    >
                      {book.title.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-[var(--text)]">
                          {book.title}
                        </span>
                        {book.missing && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-xs text-[var(--danger)]">
                            <FileWarning className="h-3 w-3" aria-hidden />
                            文件缺失
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--muted)]">
                        {formatBytes(book.file_size)} · {book.encoding} ·{" "}
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
                  <button
                    type="button"
                    onClick={() => void handleDelete(book)}
                    title="删除这本书"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
