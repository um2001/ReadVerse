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

export function setFavorite(bookId: number, favorite: boolean) {
  return invoke<Book>("set_favorite", { bookId, favorite });
}

export function setReadStatus(bookId: number, isRead: boolean) {
  return invoke<Book>("set_read", { bookId, isRead });
}

export function renameBook(bookId: number, title: string) {
  return invoke<Book>("rename_book", { bookId, title });
}

export function exportBook(bookId: number, destinationPath: string) {
  return invoke<string>("export_book", { bookId, destinationPath });
}

export function getProgress(bookId: number) {
  return invoke<ReadingProgress>("get_progress", { bookId });
}

export function saveProgress(
  bookId: number,
  charOffset: number,
  fontSize: number,
  encoding: string,
) {
  return invoke<void>("save_progress", {
    bookId,
    charOffset,
    fontSize,
    encoding,
  });
}

export function readPage(bookId: number, offset: number, encoding?: string) {
  return invoke<PageResult>("read_page", { bookId, offset, encoding });
}

export function readPreviousPage(
  bookId: number,
  offset: number,
  encoding?: string,
) {
  return invoke<PageResult>("read_previous_page", {
    bookId,
    offset,
    encoding,
  });
}

export function getPageNumber(bookId: number, offset: number, encoding?: string) {
  return invoke<number>("get_page_number", { bookId, offset, encoding });
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

export function getCover(bookId: number) {
  return invoke<string | null>("get_cover", { bookId });
}
