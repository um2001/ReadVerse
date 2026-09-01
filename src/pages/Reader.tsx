import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import {
  getPageNumber,
  getProgress,
  readPage,
  readPreviousPage,
  saveProgress,
} from "../lib/api";
import { clamp } from "../lib/format";
import type { Book, PageResult } from "../types";

interface ReaderProps {
  book: Book;
  onBack: () => void;
}

interface PageCacheEntry {
  text: string;
  nextOffset: number;
  eof: boolean;
}

export function Reader({ book, onBack }: ReaderProps) {
  const [fontSize, setFontSize] = useState(18);
  const [pageText, setPageText] = useState("");
  const [currentOffset, setCurrentOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [eof, setEof] = useState(false);
  const [pageStack, setPageStack] = useState<number[]>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const offsetRef = useRef(0);
  const fontSizeRef = useRef(18);
  const pageNumberRef = useRef(1);
  const stackRef = useRef<number[]>([]);
  const cacheRef = useRef(new Map<number, PageCacheEntry>());
  const loadedRef = useRef(false);

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
      return page;
    },
    [book.id],
  );

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const progress = await getProgress(book.id);
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

  const goNext = useCallback(() => {
    if (eof || !ready) return;
    stackRef.current = [...stackRef.current, offsetRef.current];
    setPageStack(stackRef.current);
    void loadPage(nextOffset).then(() => {
      pageNumberRef.current += 1;
      setPageNumber(pageNumberRef.current);
      persist(offsetRef.current, fontSizeRef.current);
    });
  }, [eof, loadPage, nextOffset, persist, ready]);

  const goPrev = useCallback(() => {
    if (!ready) return;
    if (stackRef.current.length > 0) {
      const target = stackRef.current[stackRef.current.length - 1];
      stackRef.current = stackRef.current.slice(0, -1);
      setPageStack(stackRef.current);
      void loadPage(target).then(() => {
        pageNumberRef.current = Math.max(1, pageNumberRef.current - 1);
        setPageNumber(pageNumberRef.current);
        persist(offsetRef.current, fontSizeRef.current);
      });
      return;
    }
    if (offsetRef.current === 0) return;

    void readPreviousPage(book.id, offsetRef.current)
      .then((page) => {
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
        pageNumberRef.current = Math.max(1, pageNumberRef.current - 1);
        setPageNumber(pageNumberRef.current);
        persist(start, fontSizeRef.current);
      })
      .catch((err) => setError(String(err)));
  }, [book.id, loadPage, persist, ready]);

  function changeFont(delta: number) {
    const next = clamp(fontSize + delta, 14, 34);
    fontSizeRef.current = next;
    setFontSize(next);
    persist(offsetRef.current, next);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight" || event.key === "PageDown") goNext();
      if (event.key === "ArrowLeft" || event.key === "PageUp") goPrev();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev]);

  const percent =
    book.char_count <= 0
      ? 0
      : clamp(Math.round((currentOffset / book.char_count) * 100), 0, 100);
  const canGoPrev = pageStack.length > 0 || currentOffset > 0;

  return (
    <div className="flex h-full flex-col bg-[#fbfcfa]">
      <header className="z-10 border-b border-[#dde3dc] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <button
            type="button"
            onClick={onBack}
            title="返回书架"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#445149] transition hover:bg-[#eef3f0]"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-[#1c2620]">
              {book.title}
            </h1>
            <p className="text-xs text-[#6b756f]">已读 {percent}%</p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => changeFont(-1)}
              disabled={fontSize <= 14}
              title="减小字号"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#445149] transition hover:bg-[#eef3f0] disabled:opacity-40"
            >
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <span className="w-8 text-center text-xs font-medium text-[#6b756f]">
              {fontSize}
            </span>
            <button
              type="button"
              onClick={() => changeFont(1)}
              disabled={fontSize >= 34}
              title="增大字号"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#445149] transition hover:bg-[#eef3f0] disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="mx-auto max-w-2xl px-6 py-16 text-center text-sm text-red-700">
            {error}
          </div>
        ) : !ready ? (
          <div className="py-24 text-center text-sm text-[#7b8580]">
            正在打开书籍…
          </div>
        ) : pageText.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <RotateCcw className="h-6 w-6 text-[#98a29d]" aria-hidden />
            <p className="text-sm text-[#6b756f]">已经读到结尾了</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-8 py-10 sm:px-12">
            <p
              className="reader-text leading-9 text-[#24302a]"
              style={{ fontSize: `${fontSize}px` }}
            >
              {pageText}
            </p>
          </div>
        )}
      </main>

      <footer className="border-t border-[#dde3dc] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <button
            type="button"
            onClick={goPrev}
            disabled={!ready || !canGoPrev}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-[#445149] transition hover:bg-[#eef3f0] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            上一页
          </button>
          <span className="text-xs text-[#7b8580]">
            {`第 ${pageNumber} 页 · ${fontSize}px`}
          </span>
          <button
            type="button"
            onClick={goNext}
            disabled={eof || !ready}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-[#445149] transition hover:bg-[#eef3f0] disabled:cursor-not-allowed disabled:opacity-40"
          >
            下一页
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </footer>
    </div>
  );
}
