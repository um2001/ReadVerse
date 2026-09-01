import { invoke } from "@tauri-apps/api/core";
import type {
  Book,
  Bookmark,
  Chapter,
  PageResult,
  ReadingProgress,
  SearchResult,
  Settings,
} from "../types";

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

export function getPageNumber(bookId: number, offset: number) {
  return invoke<number>("get_page_number", { bookId, offset });
}

export function getChapters(bookId: number) {
  return invoke<Chapter[]>("get_chapters", { bookId });
}

export function searchBook(bookId: number, query: string, limit?: number) {
  return invoke<SearchResult[]>("search_book", { bookId, query, limit });
}

export function getSettings() {
  return invoke<Settings>("get_settings");
}

export function saveSettings(settings: Settings) {
  return invoke<void>("save_settings", { settings });
}

export function addBookmark(
  bookId: number,
  charOffset: number,
  excerpt: string,
) {
  return invoke<Bookmark>("add_bookmark", {
    bookId,
    charOffset,
    excerpt,
  });
}

export function listBookmarks(bookId: number) {
  return invoke<Bookmark[]>("list_bookmarks", { bookId });
}

export function deleteBookmark(bookmarkId: number) {
  return invoke<void>("delete_bookmark", { bookmarkId });
}
