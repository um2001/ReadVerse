import { useCallback, useEffect, useState } from "react";
import { BookOpen, LibraryBig, Trash2, Upload } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { deleteBook, importBook, listBooks } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";
import type { Book } from "../types";

interface ShelfProps {
  onOpen: (book: Book) => void;
}

export function Shelf({ onOpen }: ShelfProps) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

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
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "TXT 电子书", extensions: ["txt"] }],
      });
      if (typeof selected === "string") {
        await importBook(selected);
        await refresh();
      }
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

  return (
    <div className="min-h-full">
      <header className="border-b border-[#dde3dc] bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0f766e] text-white">
            <BookOpen className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-5 text-[#1c2620]">
              ReadVerse
            </h1>
            <p className="text-xs text-[#6b756f]">本地 TXT 阅读器</p>
          </div>
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#0c5f59] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload className="h-4 w-4" aria-hidden />
            {importing ? "正在导入…" : "导入 TXT"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-5 flex items-center gap-2 text-[#445149]">
          <LibraryBig className="h-4 w-4" aria-hidden />
          <h2 className="text-sm font-semibold">我的书架</h2>
          {!loading && <span className="text-xs text-[#7b8580]">{books.length} 本</span>}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-sm text-[#7b8580]">正在加载书架…</div>
        ) : books.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#c8d1ca] bg-[#fbfcfa] px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#e6f0ed] text-[#0f766e]">
              <BookOpen className="h-7 w-7" aria-hidden />
            </div>
            <h3 className="text-base font-medium text-[#26332c]">
              书架还是空的
            </h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[#6b756f]">
              导入一本本地 TXT 电子书，阅读位置会自动保存。
            </p>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0c5f59] disabled:opacity-60"
            >
              <Upload className="h-4 w-4" aria-hidden />
              导入第一本书
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {books.map((book) => (
              <li
                key={book.id}
                className="group flex items-center gap-4 rounded-lg border border-[#dde3dc] bg-white px-4 py-3 shadow-sm transition hover:border-[#b9c9c0] hover:shadow"
              >
                <button
                  type="button"
                  onClick={() => onOpen(book)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eef3f0] text-[#0f766e]">
                    <BookOpen className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[#1c2620]">
                      {book.title}
                    </span>
                    <span className="mt-1 block text-xs text-[#6b756f]">
                      {formatBytes(book.file_size)} · {book.encoding} ·{" "}
                      {formatDate(book.created_at)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(book)}
                  title="删除这本书"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#98a29d] transition hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
