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
};

const pages: Record<number, PageResult> = {
  12: { text: "第一页内容\n", start_offset: 12, next_offset: 40, eof: false },
  40: { text: "第二页内容\n", start_offset: 40, next_offset: 80, eof: true },
};

vi.mock("../lib/api", () => ({
  getProgress: vi.fn(),
  readPage: vi.fn(),
  readPreviousPage: vi.fn(),
  saveProgress: vi.fn(),
}));

import {
  getProgress,
  readPage,
  readPreviousPage,
  saveProgress,
} from "../lib/api";

describe("Reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProgress).mockResolvedValue({
      book_id: book.id,
      char_offset: 12,
      font_size: 20,
      updated_at: "2026-09-01 10:00:00",
    });
    vi.mocked(readPage).mockImplementation(async (_bookId, offset) => pages[offset]);
    vi.mocked(readPreviousPage).mockImplementation(async (_bookId, offset) => pages[offset]);
    vi.mocked(saveProgress).mockResolvedValue(undefined);
  });

  it("restores progress and saves the next page offset", async () => {
    render(<Reader book={book} onBack={vi.fn()} />);

    expect(await screen.findByText("第一页内容")).toBeInTheDocument();
    expect(readPage).toHaveBeenCalledWith(book.id, 12);
    expect(screen.getByText(/已读 6%/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /下一页/ }));
    expect(await screen.findByText("第二页内容")).toBeInTheDocument();
    expect(readPage).toHaveBeenCalledWith(book.id, 40);

    await waitFor(() =>
      expect(saveProgress).toHaveBeenCalledWith(book.id, 40, 20),
    );
  });

  it("changes font size and persists it", async () => {
    render(<Reader book={book} onBack={vi.fn()} />);
    await screen.findByText("第一页内容");

    await userEvent.setup().click(screen.getByTitle("增大字号"));
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(saveProgress).toHaveBeenCalledWith(book.id, 12, 21);
  });

  it("can go back to earlier content after restoring progress", async () => {
    vi.mocked(getProgress).mockResolvedValue({
      book_id: book.id,
      char_offset: 40,
      font_size: 20,
      updated_at: "2026-09-01 10:00:00",
    });
    vi.mocked(readPreviousPage).mockResolvedValue(pages[12]);

    render(<Reader book={book} onBack={vi.fn()} />);
    expect(await screen.findByText("第二页内容")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /上一页/ }));
    expect(await screen.findByText("第一页内容")).toBeInTheDocument();
    expect(readPreviousPage).toHaveBeenCalledWith(book.id, 40);

    await waitFor(() =>
      expect(saveProgress).toHaveBeenCalledWith(book.id, 12, 20),
    );
  });
});
