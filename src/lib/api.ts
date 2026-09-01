import { invoke } from "@tauri-apps/api/core";
import type { Book, PageResult, ReadingProgress } from "../types";

export function listBooks() {
  return invoke<Book[]>("list_books");
}

export function importBook(path: string) {
  return invoke<Book>("import_book", { path });
}

export function deleteBook(id: number) {
  return invoke<void>("delete_book", { bookId: id });
}

export function getProgress(bookId: number) {
  return invoke<ReadingProgress>("get_progress", { bookId });
}

export function saveProgress(
  bookId: number,
  charOffset: number,
  fontSize: number,
) {
  return invoke<void>("save_progress", {
    bookId,
    charOffset,
    fontSize,
  });
}

export function readPage(bookId: number, offset: number) {
  return invoke<PageResult>("read_page", { bookId, offset });
}

export function readPreviousPage(bookId: number, offset: number) {
  return invoke<PageResult>("read_previous_page", { bookId, offset });
}
