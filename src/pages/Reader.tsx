import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ListTree,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import {
  addBookmark,
  deleteBookmark,
  getChapters,
  getPageNumber,
  getProgress,
  listBookmarks,
  readPage,
  readPreviousPage,
  saveProgress,
  searchBook,
} from "../lib/api";
import { clamp } from "../lib/format";
import type { Book, Bookmark as BookmarkItem, Chapter, PageResult, SearchResult, Settings } from "../types";

interface ReaderProps {
  book: Book;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onBack: () => void;
}

interface PageCacheEntry {
  text: string;
  nextOffset: number;
  eof: boolean;
}

type PanelKind = "chapters" | "bookmarks" | "search" | "settings" | null;

const THEMES = [
  { value: "light" as const, label: "亮色", dot: "#eef4f0" },
  { value: "sepia" as const, label: "护眼", dot: "#c99a62" },
  { value: "night" as const, label: "夜间", dot: "#22332c" },
];

const FONT_FAMILIES = ["默认", "宋体", "楷体", "黑体"];
const LINE_HEIGHTS = ["1.6", "1.8", "2.0", "2.2"];

export function Reader({ book, settings, onSettingsChange, onBack }: ReaderProps) {
  const [fontSize, setFontSize] = useState(18);
  const [pageText, setPageText] = useState("");
  const [currentOffset, setCurrentOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [eof, setEof] = useState(false);
  const [pageStack, setPageStack] = useState<number[]>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [panel, setPanel] = useState<PanelKind>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [sliderPercent, setSliderPercent] = useState(0);

  const offsetRef = useRef(0);
  const fontSizeRef = useRef(18);
  const pageNumberRef = useRef(1);
  const stackRef = useRef<number[]>([]);
  const cacheRef = useRef(new Map<number, PageCacheEntry>());
  const loadedRef = useRef(false);
  const busyRef = useRef(false);

  const loadPage = useCallback(
    async (offset: number): Promise<PageResult> => {
      const cached = cacheRef.current.get(offset);
      const page = cached
        ? {
            text: cached.text,
            start_offset: offset,
            next_offset: cached.nextOffset,
            eof: cached.eof,
          }
        : await readPage(book.id, offset);

      if (!cached) {
        if (cacheRef.current.size >= 80) {
          const oldest = cacheRef.current.keys().next().value;
          if (oldest !== undefined) cacheRef.current.delete(oldest);
        }
        cacheRef.current.set(offset, {
          text: page.text,
          nextOffset: page.next_offset,
          eof: page.eof,
        });
      }

      offsetRef.current = offset;
      setCurrentOffset(offset);
      setNextOffset(page.next_offset);
      setPageText(page.text);
      setEof(page.eof);
      const percent =
        book.char_count > 0
          ? clamp(Math.round((offset / book.char_count) * 100), 0, 100)
          : 0;
      setSliderPercent(percent);
      return page;
    },
    [book.char_count, book.id],
  );

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const [progress, chapterList, bookmarkList] = await Promise.all([
          getProgress(book.id),
          getChapters(book.id).catch(() => []),
          listBookmarks(book.id).catch(() => []),
        ]);
        setChapters(chapterList);
        setBookmarks(bookmarkList);
        const start =
          book.char_count > 0 && progress.char_offset >= book.char_count
            ? Math.max(0, book.char_count - 1)
            : progress.char_offset;
        fontSizeRef.current = progress.font_size;
        setFontSize(progress.font_size);
        await loadPage(start);
        const number = await getPageNumber(book.id, start).catch(() => 1);
        if (!cancelled) {
          pageNumberRef.current = number;
          setPageNumber(number);
          loadedRef.current = true;
          setReady(true);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [book, loadPage]);

  useEffect(() => {
    return () => {
      if (loadedRef.current) {
        void saveProgress(book.id, offsetRef.current, fontSizeRef.current);
      }
    };
  }, [book.id]);

  const persist = useCallback(
    (offset: number, size: number) => {
      void saveProgress(book.id, offset, size).catch(() => undefined);
    },
    [book.id],
  );

  const goNext = useCallback(async () => {
    if (eof || !ready || busyRef.current) return;
    busyRef.current = true;
    try {
      stackRef.current = [...stackRef.current, offsetRef.current];
      setPageStack(stackRef.current);
      await loadPage(nextOffset);
      pageNumberRef.current += 1;
      setPageNumber(pageNumberRef.current);
      persist(offsetRef.current, fontSizeRef.current);
    } catch (err) {
      setError(String(err));
    } finally {
      busyRef.current = false;
    }
  }, [eof, loadPage, nextOffset, persist, ready]);

  const goPrev = useCallback(async () => {
    if (!ready || busyRef.current) return;
    busyRef.current = true;
    try {
      if (stackRef.current.length > 0) {
        const target = stackRef.current[stackRef.current.length - 1];
        stackRef.current = stackRef.current.slice(0, -1);
        setPageStack(stackRef.current);
        await loadPage(target);
        pageNumberRef.current = Math.max(1, pageNumberRef.current - 1);
        setPageNumber(pageNumberRef.current);
        persist(offsetRef.current, fontSizeRef.current);
        return;
      }
      if (offsetRef.current === 0) return;

      const page = await readPreviousPage(book.id, offsetRef.current);
      if (page.text.length === 0) return;
      const start = page.start_offset;
      cacheRef.current.set(start, {
        text: page.text,
        nextOffset: page.next_offset,
        eof: page.eof,
      });
      offsetRef.current = start;
      setCurrentOffset(start);
      setNextOffset(page.next_offset);
      setPageText(page.text);
      setEof(page.eof);
      setSliderPercent(
        book.char_count > 0
          ? clamp(Math.round((start / book.char_count) * 100), 0, 100)
          : 0,
      );
      pageNumberRef.current = Math.max(1, pageNumberRef.current - 1);
      setPageNumber(pageNumberRef.current);
      persist(start, fontSizeRef.current);
    } catch (err) {
      setError(String(err));
    } finally {
      busyRef.current = false;
    }
  }, [book.char_count, book.id, loadPage, persist, ready]);

  const jumpTo = useCallback(
    async (offset: number) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        stackRef.current = [];
        setPageStack([]);
        await loadPage(offset);
        const number = await getPageNumber(book.id, offset).catch(() => 1);
        pageNumberRef.current = number;
        setPageNumber(number);
        persist(offsetRef.current, fontSizeRef.current);
      } catch (err) {
        setError(String(err));
      } finally {
        busyRef.current = false;
      }
    },
    [book.id, loadPage, persist],
  );

  function changeFont(delta: number) {
    const next = clamp(fontSize + delta, 14, 34);
    fontSizeRef.current = next;
    setFontSize(next);
    persist(offsetRef.current, next);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        void goNext();
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        void goPrev();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev]);

  async function runSearch() {
    const query = searchQuery.trim();
    if (!query) return;
    setSearching(true);
    try {
      setSearchResults(await searchBook(book.id, query, 50));
    } catch (err) {
      setError(String(err));
    } finally {
      setSearching(false);
    }
  }

  async function toggleBookmark() {
    const existing = bookmarks.find(
      (item) => item.char_offset === offsetRef.current,
    );
    try {
      if (existing) {
        await deleteBookmark(existing.id);
        setBookmarks((current) =>
          current.filter((item) => item.id !== existing.id),
        );
      } else {
        const excerpt =
          pageText.replace(/\s+/g, " ").trim().slice(0, 60) || book.title;
        const added = await addBookmark(
          book.id,
          offsetRef.current,
          excerpt,
        );
        setBookmarks((current) =>
          [...current, added].sort((a, b) => a.char_offset - b.char_offset),
        );
      }
    } catch (err) {
      setError(String(err));
    }
  }

  const percent =
    book.char_count <= 0
      ? 0
      : clamp(Math.round((currentOffset / book.char_count) * 100), 0, 100);
  const canGoPrev = pageStack.length > 0 || currentOffset > 0;
  const currentBookmarked = bookmarks.some(
    (item) => item.char_offset === currentOffset,
  );
  const currentChapter = useMemo(() => {
    let chapter: Chapter | null = null;
    for (const item of chapters) {
      if (item.char_offset <= currentOffset) chapter = item;
      else break;
    }
    return chapter;
  }, [chapters, currentOffset]);

  function commitSlider(value: number) {
    const next = clamp(Math.round(value), 0, 100);
    const offset =
      book.char_count > 0 ? Math.round((next / 100) * book.char_count) : 0;
    void jumpTo(offset);
  }

  const readerStyle: CSSProperties = {
    fontSize: `${fontSize}px`,
    lineHeight: settings.line_height,
    fontFamily:
      settings.font_family === "默认"
        ? undefined
        : `"${settings.font_family}", "PingFang SC", "Microsoft YaHei", serif`,
  };

  return (
    <div className="relative flex h-full flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="z-10 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <button
            type="button"
            onClick={onBack}
            title="返回书架"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text)] transition hover:bg-[var(--surface-soft)]"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-[var(--text)]">
              {book.title}
            </h1>
            <p className="truncate text-xs text-[var(--muted)]">
              {currentChapter ? currentChapter.title : "正在阅读"}
              {" · "}已读 {percent}%
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => void toggleBookmark()}
              title={currentBookmarked ? "删除当前书签" : "添加书签"}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-[var(--surface-soft)] ${
                currentBookmarked
                  ? "text-[var(--accent)]"
                  : "text-[var(--muted)]"
              }`}
            >
              <Bookmark
                className="h-4 w-4"
                fill={currentBookmarked ? "currentColor" : "none"}
                aria-hidden
              />
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === "search" ? null : "search")}
              title="搜索"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
            >
              <Search className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === "chapters" ? null : "chapters")}
              title="目录"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
            >
              <ListTree className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === "settings" ? null : "settings")}
              title="阅读设置"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
            </button>
            <div className="ml-2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => changeFont(-1)}
                disabled={fontSize <= 14}
                title="减小字号"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--surface-soft)] disabled:opacity-40"
              >
                <Minus className="h-4 w-4" aria-hidden />
              </button>
              <span className="w-8 text-center text-xs font-medium text-[var(--muted)]">
                {fontSize}
              </span>
              <button
                type="button"
                onClick={() => changeFont(1)}
                disabled={fontSize >= 34}
                title="增大字号"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--surface-soft)] disabled:opacity-40"
              >
                <Plus className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="mx-auto max-w-2xl px-6 py-16 text-center text-sm text-[var(--danger)]">
            {error}
          </div>
        ) : !ready ? (
          <div className="py-24 text-center text-sm text-[var(--muted)]">
            正在打开书籍…
          </div>
        ) : pageText.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <RotateCcw className="h-6 w-6 text-[var(--muted)]" aria-hidden />
            <p className="text-sm text-[var(--muted)]">已经读到结尾了</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-8 py-10 sm:px-12">
            <p className="reader-text text-[var(--text)]" style={readerStyle}>
              {pageText}
            </p>
          </div>
        )}
      </main>

      {panel && (
        <>
          <div
            className="absolute inset-0 z-20 bg-black/20"
            onClick={() => setPanel(null)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 right-0 z-30 flex w-80 max-w-[92vw] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-xl">
            <div className="flex h-14 items-center gap-2 border-b border-[var(--border)] px-4">
              <div className="flex gap-1">
                {(
                  [
                    ["chapters", ListTree, "目录"],
                    ["bookmarks", Bookmark, "书签"],
                    ["search", Search, "搜索"],
                    ["settings", Settings2, "设置"],
                  ] as const
                ).map(([kind, Icon, label]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setPanel(kind)}
                    title={label}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
                      panel === kind
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "text-[var(--muted)] hover:bg-[var(--surface-soft)]"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPanel(null)}
                title="关闭"
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--surface-soft)]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {panel === "chapters" && (
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">
                    目录
                  </h2>
                  {chapters.length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">
                      未识别到章节，可继续按页阅读。
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {chapters.map((chapter) => (
                        <li key={chapter.id}>
                          <button
                            type="button"
                            onClick={() => void jumpTo(chapter.char_offset)}
                            className={`w-full truncate rounded-lg px-3 py-2 text-left text-sm transition ${
                              currentChapter?.char_offset === chapter.char_offset
                                ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                                : "text-[var(--text)] hover:bg-[var(--surface-soft)]"
                            }`}
                          >
                            {chapter.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {panel === "bookmarks" && (
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">
                    书签
                  </h2>
                  {bookmarks.length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">
                      点击顶部书签按钮，为当前位置添加书签。
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {bookmarks.map((item) => (
                        <li
                          key={item.id}
                          className="group rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3"
                        >
                          <button
                            type="button"
                            onClick={() => void jumpTo(item.char_offset)}
                            className="w-full text-left"
                          >
                            <p className="line-clamp-2 text-sm leading-6 text-[var(--text)]">
                              {item.excerpt || "书签"}
                            </p>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              位置 {Math.round((item.char_offset / Math.max(book.char_count, 1)) * 100)}%
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void deleteBookmark(item.id).then(() =>
                                setBookmarks((current) =>
                                  current.filter((entry) => entry.id !== item.id),
                                ),
                              );
                            }}
                            title="删除书签"
                            className="mt-2 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {panel === "search" && (
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">
                    全文搜索
                  </h2>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void runSearch();
                    }}
                    className="flex gap-2"
                  >
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="输入搜索关键词"
                      className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={searching || !searchQuery.trim()}
                      className="inline-flex h-9 items-center gap-1 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-50"
                    >
                      <Search className="h-4 w-4" aria-hidden />
                      搜索
                    </button>
                  </form>
                  {searching ? (
                    <p className="mt-4 text-sm text-[var(--muted)]">正在搜索…</p>
                  ) : searchResults.length > 0 ? (
                    <ul className="mt-4 space-y-2">
                      {searchResults.map((result) => (
                        <li key={result.char_offset}>
                          <button
                            type="button"
                            onClick={() => void jumpTo(result.char_offset)}
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-left transition hover:border-[var(--accent)]"
                          >
                            <p className="line-clamp-2 text-sm leading-6 text-[var(--text)]">
                              {result.snippet}
                            </p>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              {result.chapter_title || "正文"}
                            </p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    searchQuery.trim() && (
                      <p className="mt-4 text-sm text-[var(--muted)]">
                        没有找到匹配内容。
                      </p>
                    )
                  )}
                </div>
              )}

              {panel === "settings" && (
                <div className="space-y-5">
                  <div>
                    <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">
                      阅读主题
                    </h2>
                    <div className="grid grid-cols-3 gap-2">
                      {THEMES.map((theme) => (
                        <button
                          key={theme.value}
                          type="button"
                          onClick={() =>
                            onSettingsChange({ theme: theme.value })
                          }
                          className={`flex flex-col items-center gap-2 rounded-lg border px-3 py-3 text-sm transition ${
                            settings.theme === theme.value
                              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                              : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-soft)]"
                          }`}
                        >
                          <span
                            className="h-5 w-5 rounded-full border border-[var(--border)] shadow-sm"
                            style={{ background: theme.dot }}
                            aria-hidden
                          />
                          {theme.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text)]">
                      正文字体
                    </span>
                    <select
                      value={settings.font_family}
                      onChange={(event) =>
                        onSettingsChange({ font_family: event.target.value })
                      }
                      className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                    >
                      {FONT_FAMILIES.map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text)]">
                      行距
                    </span>
                    <select
                      value={settings.line_height}
                      onChange={(event) =>
                        onSettingsChange({ line_height: event.target.value })
                      }
                      className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                    >
                      {LINE_HEIGHTS.map((height) => (
                        <option key={height} value={height}>
                          {height}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>
          </aside>
        </>
      )}

      <div className="border-t border-[var(--border)] bg-[var(--surface)]/90 px-6 pb-1 pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <span className="w-10 shrink-0 text-right text-xs text-[var(--muted)]">
            {percent}%
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={sliderPercent}
            onChange={(event) => setSliderPercent(Number(event.target.value))}
            onPointerUp={(event) =>
              commitSlider(Number((event.target as HTMLInputElement).value))
            }
            onKeyUp={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                commitSlider(Number((event.target as HTMLInputElement).value));
              }
            }}
            className="min-w-0 flex-1"
            aria-label="阅读进度"
          />
          <span className="w-16 shrink-0 text-xs text-[var(--muted)]">
            第 {pageNumber} 页
          </span>
        </div>
      </div>

      <footer className="border-t border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-3xl items-center justify-between px-6">
          <button
            type="button"
            onClick={() => void goPrev()}
            disabled={!ready || !canGoPrev}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-[var(--text)] transition hover:bg-[var(--surface-soft)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            上一页
          </button>
          <span className="text-xs text-[var(--muted)]">{fontSize}px</span>
          <button
            type="button"
            onClick={() => void goNext()}
            disabled={eof || !ready}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-[var(--text)] transition hover:bg-[var(--surface-soft)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            下一页
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </footer>
    </div>
  );
}
