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
    missing: false,
    last_char_offset: 240,
    font_size: 18,
    last_read_at: "2026-09-01 11:00:00",
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
  missing: false,
  last_char_offset: 0,
  font_size: 18,
  last_read_at: "",
};

vi.mock("../lib/api", () => ({
  listBooks: vi.fn(),
  importBook: vi.fn(),
  deleteBook: vi.fn(),
  exportBook: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import { deleteBook, exportBook, importBook, listBooks } from "../lib/api";
import { open, save } from "@tauri-apps/plugin-dialog";

const settings = {
  theme: "light" as const,
  font_family: "默认",
  line_height: "1.8",
};

describe("Shelf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listBooks).mockResolvedValue(books);
    vi.mocked(importBook).mockResolvedValue(newBook);
    vi.mocked(deleteBook).mockResolvedValue(undefined);
    vi.mocked(exportBook).mockResolvedValue("C:\\out\\test.txt");
    vi.mocked(open).mockResolvedValue("C:\\incoming\\new.txt");
    vi.mocked(save).mockResolvedValue("C:\\out\\test.txt");
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows imported books and imports a new one", async () => {
    vi.mocked(listBooks).mockReset();
    vi.mocked(listBooks)
      .mockResolvedValueOnce(books)
      .mockResolvedValueOnce([...books, newBook]);

    render(
      <Shelf
        onOpen={vi.fn()}
        settings={settings}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(await screen.findByText("测试书")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "导入 TXT" }));

    await waitFor(() => expect(importBook).toHaveBeenCalledWith("C:\\incoming\\new.txt"));
    await waitFor(() => expect(listBooks).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("新导入书")).toBeInTheDocument();
  });

  it("deletes a book after confirmation", async () => {
    render(
      <Shelf
        onOpen={vi.fn()}
        settings={settings}
        onSettingsChange={vi.fn()}
      />,
    );
    await screen.findByText("测试书");

    const user = userEvent.setup();
    await user.click(screen.getByTitle("删除这本书"));

    expect(window.confirm).toHaveBeenCalledWith("确定删除《测试书》吗？");
    expect(deleteBook).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByText("测试书")).not.toBeInTheDocument());
  });

  it("opens a book when its row is clicked", async () => {
    const onOpen = vi.fn();
    render(
      <Shelf
        onOpen={onOpen}
        settings={settings}
        onSettingsChange={vi.fn()}
      />,
    );
    await screen.findByText("测试书");

    await userEvent.setup().click(screen.getByText("测试书"));
    expect(onOpen).toHaveBeenCalledWith(books[0]);
  });

  it("exports a book through the save dialog", async () => {
    render(
      <Shelf
        onOpen={vi.fn()}
        settings={settings}
        onSettingsChange={vi.fn()}
      />,
    );
    await screen.findByText("测试书");

    await userEvent.setup().click(screen.getByTitle("导出这本书"));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "测试书.txt" }),
    );
    await waitFor(() =>
      expect(exportBook).toHaveBeenCalledWith(1, "C:\\out\\test.txt"),
    );
  });

  it("opens reading settings from the shelf header", async () => {
    render(
      <Shelf
        onOpen={vi.fn()}
        settings={settings}
        onSettingsChange={vi.fn()}
      />,
    );
    await screen.findByText("测试书");

    await userEvent.setup().click(screen.getByTitle("阅读设置"));

    expect(screen.getByText("阅读主题")).toBeInTheDocument();
  });
});
