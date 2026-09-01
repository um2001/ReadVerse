use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::db::{self, Book, ReadingProgress};
use crate::reader::{self, Reader};
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub char_offset: usize,
    pub snippet: String,
    pub chapter_title: String,
}

#[tauri::command]
pub fn list_books(state: State<'_, AppState>) -> Result<Vec<Book>, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    db::list_books(&conn)
}

#[tauri::command]
pub fn import_book(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Book, String> {
    let data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let books_dir = data_dir.join("books");
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    crate::import::import_file(&conn, Path::new(&path), &books_dir)
}

#[tauri::command]
pub fn delete_book(state: State<'_, AppState>, book_id: i64) -> Result<(), String> {
    let file_path = {
        let conn = state.db.lock().map_err(|err| err.to_string())?;
        db::delete_book(&conn, book_id)?
    };
    {
        let mut readers = state.readers.lock().map_err(|err| err.to_string())?;
        readers.remove(&book_id);
    }
    if let Some(file_path) = file_path {
        let _ = fs::remove_file(file_path);
    }
    Ok(())
}

#[tauri::command]
pub fn export_book(
    state: State<'_, AppState>,
    book_id: i64,
    destination_path: String,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let book = db::book_by_id(&conn, book_id)?
        .ok_or_else(|| "书籍不存在".to_string())?;
    if book.missing {
        return Err("书籍文件缺失，无法导出".to_string());
    }
    crate::import::export_file(
        Path::new(&book.file_path),
        Path::new(&destination_path),
    )?;
    Ok(destination_path)
}

#[tauri::command]
pub fn get_progress(
    state: State<'_, AppState>,
    book_id: i64,
) -> Result<ReadingProgress, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    if db::book_by_id(&conn, book_id)?.is_none() {
        return Err("书籍不存在".to_string());
    }
    db::get_progress(&conn, book_id)
}

#[tauri::command]
pub fn save_progress(
    state: State<'_, AppState>,
    book_id: i64,
    char_offset: i64,
    font_size: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    db::save_progress(&conn, book_id, char_offset, font_size)
}

#[tauri::command]
pub fn read_page(
    state: State<'_, AppState>,
    book_id: i64,
    offset: usize,
) -> Result<reader::Page, String> {
    let book = {
        let conn = state.db.lock().map_err(|err| err.to_string())?;
        db::book_by_id(&conn, book_id)?
            .ok_or_else(|| "书籍不存在".to_string())?
    };
    let mut readers = state.readers.lock().map_err(|err| err.to_string())?;
    if !readers.contains_key(&book_id) {
        let encoding = encoding_rs::Encoding::for_label(book.encoding.as_bytes())
            .unwrap_or(encoding_rs::UTF_8);
        let reader = Reader::open(Path::new(&book.file_path), encoding)?;
        readers.insert(book_id, Arc::new(Mutex::new(reader)));
    }
    let reader = readers
        .get(&book_id)
        .ok_or_else(|| "阅读器初始化失败".to_string())?;
    let mut reader = reader.lock().map_err(|err| err.to_string())?;
    reader.read_page(offset, reader::DEFAULT_PAGE_CHARS)
}

#[tauri::command]
pub fn read_previous_page(
    state: State<'_, AppState>,
    book_id: i64,
    offset: usize,
) -> Result<reader::Page, String> {
    let book = {
        let conn = state.db.lock().map_err(|err| err.to_string())?;
        db::book_by_id(&conn, book_id)?
            .ok_or_else(|| "书籍不存在".to_string())?
    };
    let mut readers = state.readers.lock().map_err(|err| err.to_string())?;
    if !readers.contains_key(&book_id) {
        let encoding = encoding_rs::Encoding::for_label(book.encoding.as_bytes())
            .unwrap_or(encoding_rs::UTF_8);
        let reader = Reader::open(Path::new(&book.file_path), encoding)?;
        readers.insert(book_id, Arc::new(Mutex::new(reader)));
    }
    let reader = readers
        .get(&book_id)
        .ok_or_else(|| "阅读器初始化失败".to_string())?;
    let mut reader = reader.lock().map_err(|err| err.to_string())?;
    reader.previous_page(offset, reader::DEFAULT_PAGE_CHARS)
}

#[tauri::command]
pub fn get_page_number(
    state: State<'_, AppState>,
    book_id: i64,
    offset: usize,
) -> Result<usize, String> {
    let book = {
        let conn = state.db.lock().map_err(|err| err.to_string())?;
        db::book_by_id(&conn, book_id)?
            .ok_or_else(|| "书籍不存在".to_string())?
    };
    let mut readers = state.readers.lock().map_err(|err| err.to_string())?;
    if !readers.contains_key(&book_id) {
        let encoding = encoding_rs::Encoding::for_label(book.encoding.as_bytes())
            .unwrap_or(encoding_rs::UTF_8);
        let reader = Reader::open(Path::new(&book.file_path), encoding)?;
        readers.insert(book_id, Arc::new(Mutex::new(reader)));
    }
    let reader = readers
        .get(&book_id)
        .ok_or_else(|| "阅读器初始化失败".to_string())?;
    let mut reader = reader.lock().map_err(|err| err.to_string())?;
    reader.page_number_at(offset, reader::DEFAULT_PAGE_CHARS)
}

fn ensure_chapters(conn: &Connection, book: &db::Book) -> Result<(), String> {
    if !db::list_chapters(conn, book.id)?.is_empty() {
        return Ok(());
    }
    let encoding = encoding_rs::Encoding::for_label(book.encoding.as_bytes())
        .unwrap_or(encoding_rs::UTF_8);
    let candidates = reader::scan_chapters(Path::new(&book.file_path), encoding)?;
    let items = candidates
        .iter()
        .map(|candidate| (candidate.title.clone(), candidate.char_offset))
        .collect::<Vec<_>>();
    db::replace_chapters(conn, book.id, &items)
}

#[tauri::command]
pub fn get_chapters(
    state: State<'_, AppState>,
    book_id: i64,
) -> Result<Vec<db::Chapter>, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let book = db::book_by_id(&conn, book_id)?
        .ok_or_else(|| "书籍不存在".to_string())?;
    ensure_chapters(&conn, &book)?;
    db::list_chapters(&conn, book_id)
}

#[tauri::command]
pub fn search_book(
    state: State<'_, AppState>,
    book_id: i64,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let book = db::book_by_id(&conn, book_id)?
        .ok_or_else(|| "书籍不存在".to_string())?;
    ensure_chapters(&conn, &book)?;
    let encoding = encoding_rs::Encoding::for_label(book.encoding.as_bytes())
        .unwrap_or(encoding_rs::UTF_8);
    let hits = reader::search_file(
        Path::new(&book.file_path),
        encoding,
        &query,
        limit.unwrap_or(50),
    )?;
    let mut results = Vec::with_capacity(hits.len());
    for hit in hits {
        let chapter_title = db::chapter_title_at(&conn, book_id, hit.char_offset as i64)?
            .unwrap_or_default();
        results.push(SearchHit {
            char_offset: hit.char_offset,
            snippet: hit.snippet,
            chapter_title,
        });
    }
    Ok(results)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<db::Settings, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    db::get_settings(&conn)
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    settings: db::Settings,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    db::save_settings(&conn, &settings)
}

#[tauri::command]
pub fn add_bookmark(
    state: State<'_, AppState>,
    book_id: i64,
    char_offset: usize,
    excerpt: String,
) -> Result<db::Bookmark, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    if db::book_by_id(&conn, book_id)?.is_none() {
        return Err("书籍不存在".to_string());
    }
    db::add_bookmark(&conn, book_id, char_offset as i64, &excerpt)
}

#[tauri::command]
pub fn list_bookmarks(
    state: State<'_, AppState>,
    book_id: i64,
) -> Result<Vec<db::Bookmark>, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    db::list_bookmarks(&conn, book_id)
}

#[tauri::command]
pub fn delete_bookmark(state: State<'_, AppState>, bookmark_id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    db::delete_bookmark(&conn, bookmark_id)
}
