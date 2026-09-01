import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Book } from "../types";
import { Shelf } from "./Shelf";

const books: Book[] = [
  {
    id: 1,
    title: "测试书",
    file_path: "C:\\books\\1.txt",
    file_size: 2048,
    encoding: "UTF-8",
    char_count: 1200,
    created_at: "2026-09-01 10:00:00",
  },
];

const newBook: Book = {
  id: 2,
  title: "新导入书",
  file_path: "C:\\books\\2.txt",
  file_size: 4096,
  encoding: "GBK",
  char_count: 800,
  created_at: "2026-09-01 11:00:00",
};

vi.mock("../lib/api", () => ({
  listBooks: vi.fn(),
  importBook: vi.fn(),
  deleteBook: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { deleteBook, importBook, listBooks } from "../lib/api";
import { open } from "@tauri-apps/plugin-dialog";

describe("Shelf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listBooks).mockResolvedValue(books);
    vi.mocked(importBook).mockResolvedValue(newBook);
    vi.mocked(deleteBook).mockResolvedValue(undefined);
    vi.mocked(open).mockResolvedValue("C:\\incoming\\new.txt");
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows imported books and imports a new one", async () => {
    vi.mocked(listBooks).mockReset();
    vi.mocked(listBooks)
      .mockResolvedValueOnce(books)
      .mockResolvedValueOnce([...books, newBook]);

    render(<Shelf onOpen={vi.fn()} />);
    expect(await screen.findByText("测试书")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "导入 TXT" }));

    await waitFor(() => expect(importBook).toHaveBeenCalledWith("C:\\incoming\\new.txt"));
    await waitFor(() => expect(listBooks).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("新导入书")).toBeInTheDocument();
  });

  it("deletes a book after confirmation", async () => {
    render(<Shelf onOpen={vi.fn()} />);
    await screen.findByText("测试书");

    const user = userEvent.setup();
    await user.click(screen.getByTitle("删除这本书"));

    expect(window.confirm).toHaveBeenCalledWith("确定删除《测试书》吗？");
    expect(deleteBook).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByText("测试书")).not.toBeInTheDocument());
  });

  it("opens a book when its row is clicked", async () => {
    const onOpen = vi.fn();
    render(<Shelf onOpen={onOpen} />);
    await screen.findByText("测试书");

    await userEvent.setup().click(screen.getByText("测试书"));
    expect(onOpen).toHaveBeenCalledWith(books[0]);
  });
});
