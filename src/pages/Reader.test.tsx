import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Book, PageResult } from "../types";
import { Reader } from "./Reader";

const book: Book = {
  id: 7,
  title: "阅读测试",
  file_path: "C:\\books\\7.txt",
  file_size: 1024,
  encoding: "UTF-8",
  char_count: 200,
  created_at: "2026-09-01 10:00:00",
  format: "txt",
  cover_path: "",
  is_favorite: false,
  is_read: false,
  missing: false,
  last_char_offset: 12,
  font_size: 20,
  last_read_at: "2026-09-01 10:00:00",
};

const pages: Record<number, PageResult> = {
  12: { text: "第一页内容\n", start_offset: 12, next_offset: 40, eof: false },
  40: { text: "第二页内容\n", start_offset: 40, next_offset: 80, eof: true },
  80: { text: "第二章内容\n", start_offset: 80, next_offset: 120, eof: true },
};

vi.mock("../lib/api", () => ({
  getPageNumber: vi.fn(),
  getProgress: vi.fn(),
  readPage: vi.fn(),
  readPreviousPage: vi.fn(),
  saveProgress: vi.fn(),
  exportBook: vi.fn(),
  getChapters: vi.fn(),
  listBookmarks: vi.fn(),
  addBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
  searchBook: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import {
  getPageNumber,
  getProgress,
  readPage,
  readPreviousPage,
  saveProgress,
  getChapters,
  listBookmarks,
  addBookmark,
  deleteBookmark,
  searchBook,
} from "../lib/api";

describe("Reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPageNumber).mockResolvedValue(1);
    vi.mocked(getProgress).mockResolvedValue({
      book_id: book.id,
      char_offset: 12,
      font_size: 20,
      encoding: "auto",
      updated_at: "2026-09-01 10:00:00",
    });
    vi.mocked(readPage).mockImplementation(async (_bookId, offset) => pages[offset]);
    vi.mocked(readPreviousPage).mockImplementation(async (_bookId, offset) => pages[offset]);
    vi.mocked(saveProgress).mockResolvedValue(undefined);
    vi.mocked(getChapters).mockResolvedValue([]);
    vi.mocked(listBookmarks).mockResolvedValue([]);
    vi.mocked(addBookmark).mockResolvedValue({
      id: 1,
      book_id: book.id,
      char_offset: 12,
      excerpt: "第一页内容",
      created_at: "2026-09-01 10:00:00",
    });
    vi.mocked(deleteBookmark).mockResolvedValue(undefined);
    vi.mocked(searchBook).mockResolvedValue([]);
  });

  it("restores progress and saves the next page offset", async () => {
    render(
      <Reader
        book={book}
        settings={{ theme: "light", font_family: "默认", line_height: "1.8" }}
        onSettingsChange={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByText("第一页内容")).toBeInTheDocument();
    expect(readPage).toHaveBeenCalledWith(book.id, 12, "auto");
    expect(screen.getByText(/已读 6%/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /下一页/ }));
    expect(await screen.findByText("第二页内容")).toBeInTheDocument();
    expect(readPage).toHaveBeenCalledWith(book.id, 40, "auto");

    await waitFor(() =>
      expect(saveProgress).toHaveBeenCalledWith(book.id, 40, 20, "auto"),
    );
  });

  it("changes font size and persists it", async () => {
    render(
      <Reader
        book={book}
        settings={{ theme: "light", font_family: "默认", line_height: "1.8" }}
        onSettingsChange={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    await screen.findByText("第一页内容");

    await userEvent.setup().click(screen.getByTitle("增大字号"));
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(saveProgress).toHaveBeenCalledWith(book.id, 12, 21, "auto");
  });

  it("can go back to earlier content after restoring progress", async () => {
    vi.mocked(getProgress).mockResolvedValue({
      book_id: book.id,
      char_offset: 40,
      font_size: 20,
      encoding: "auto",
      updated_at: "2026-09-01 10:00:00",
    });
    vi.mocked(getPageNumber).mockResolvedValue(2);
    vi.mocked(readPreviousPage).mockResolvedValue(pages[12]);

    render(
      <Reader
        book={book}
        settings={{ theme: "light", font_family: "默认", line_height: "1.8" }}
        onSettingsChange={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(await screen.findByText("第二页内容")).toBeInTheDocument();
    expect(screen.getByText(/第 2 页/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /上一页/ }));
    expect(await screen.findByText("第一页内容")).toBeInTheDocument();
    expect(screen.getByText(/第 1 页/)).toBeInTheDocument();
    expect(readPreviousPage).toHaveBeenCalledWith(book.id, 40, "auto");

    await waitFor(() =>
      expect(saveProgress).toHaveBeenCalledWith(book.id, 12, 20, "auto"),
    );
  });

  it("opens the chapter list and jumps to a chapter", async () => {
    vi.mocked(getChapters).mockResolvedValue([
      { id: 1, book_id: book.id, title: "第一章", char_offset: 0 },
      { id: 2, book_id: book.id, title: "第二章", char_offset: 80 },
    ]);

    render(
      <Reader
        book={book}
        settings={{ theme: "light", font_family: "默认", line_height: "1.8" }}
        onSettingsChange={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    await screen.findByText("第一页内容");

    await userEvent.setup().click(screen.getByTitle("目录"));
    await userEvent.setup().click(screen.getByText("第二章"));

    expect(readPage).toHaveBeenCalledWith(book.id, 80, "auto");
  });

  it("switches encoding and reloads the current page", async () => {
    render(
      <Reader
        book={book}
        settings={{ theme: "light", font_family: "默认", line_height: "1.8" }}
        onSettingsChange={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    await screen.findByText("第一页内容");

    await userEvent
      .setup()
      .selectOptions(screen.getByLabelText("编码"), "GBK");

    expect(readPage).toHaveBeenCalledWith(book.id, 12, "GBK");
    await waitFor(() =>
      expect(saveProgress).toHaveBeenCalledWith(book.id, 12, 20, "GBK"),
    );
  });
});
