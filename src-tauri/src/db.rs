use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Book {
    pub id: i64,
    pub title: String,
    pub file_path: String,
    pub file_size: i64,
    pub encoding: String,
    pub char_count: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadingProgress {
    pub book_id: i64,
    pub char_offset: i64,
    pub font_size: i64,
    pub updated_at: String,
}

pub fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|err| err.to_string())?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            encoding TEXT NOT NULL,
            char_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS reading_progress (
            book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
            char_offset INTEGER NOT NULL DEFAULT 0,
            font_size INTEGER NOT NULL DEFAULT 18,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        ",
    )
    .map_err(|err| err.to_string())?;
    Ok(conn)
}

pub fn insert_book(
    conn: &Connection,
    title: &str,
    file_path: &Path,
    file_size: i64,
    encoding: &str,
    char_count: i64,
) -> Result<Book, String> {
    conn.execute(
        "INSERT INTO books (title, file_path, file_size, encoding, char_count)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![title, file_path.to_string_lossy(), file_size, encoding, char_count],
    )
    .map_err(|err| err.to_string())?;
    book_by_id(conn, conn.last_insert_rowid())?
        .ok_or_else(|| "导入失败：书籍记录不存在".to_string())
}

pub fn book_by_id(conn: &Connection, id: i64) -> Result<Option<Book>, String> {
    conn.query_row(
        "SELECT id, title, file_path, file_size, encoding, char_count, created_at
         FROM books WHERE id = ?1",
        params![id],
        book_from_row,
    )
    .optional()
    .map_err(|err| err.to_string())
}

pub fn list_books(conn: &Connection) -> Result<Vec<Book>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, file_path, file_size, encoding, char_count, created_at
             FROM books ORDER BY created_at DESC, id DESC",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], book_from_row)
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub fn delete_book(conn: &Connection, id: i64) -> Result<Option<String>, String> {
    let file_path = conn
        .query_row(
            "SELECT file_path FROM books WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    conn.execute("DELETE FROM books WHERE id = ?1", params![id])
        .map_err(|err| err.to_string())?;
    Ok(file_path)
}

pub fn get_progress(conn: &Connection, book_id: i64) -> Result<ReadingProgress, String> {
    let progress = conn
        .query_row(
            "SELECT book_id, char_offset, font_size, updated_at
             FROM reading_progress WHERE book_id = ?1",
            params![book_id],
            |row| {
                Ok(ReadingProgress {
                    book_id: row.get(0)?,
                    char_offset: row.get(1)?,
                    font_size: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())?;
    Ok(progress.unwrap_or(ReadingProgress {
        book_id,
        char_offset: 0,
        font_size: 18,
        updated_at: String::new(),
    }))
}

pub fn save_progress(
    conn: &Connection,
    book_id: i64,
    char_offset: i64,
    font_size: i64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO reading_progress (book_id, char_offset, font_size)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(book_id) DO UPDATE SET
            char_offset = excluded.char_offset,
            font_size = excluded.font_size,
            updated_at = datetime('now')",
        params![book_id, char_offset, font_size],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn book_from_row(row: &Row<'_>) -> rusqlite::Result<Book> {
    Ok(Book {
        id: row.get(0)?,
        title: row.get(1)?,
        file_path: row.get(2)?,
        file_size: row.get(3)?,
        encoding: row.get(4)?,
        char_count: row.get(5)?,
        created_at: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn books_and_progress_roundtrip() {
        let dir = tempdir().unwrap();
        let conn = open(&dir.path().join("test.db")).unwrap();
        let book = insert_book(
            &conn,
            "测试书",
            Path::new("C:\\books\\1.txt"),
            1024,
            "GBK",
            120,
        )
        .unwrap();

        assert!(book.id > 0);
        assert_eq!(list_books(&conn).unwrap().len(), 1);

        save_progress(&conn, book.id, 42, 20).unwrap();
        let progress = get_progress(&conn, book.id).unwrap();
        assert_eq!(progress.char_offset, 42);
        assert_eq!(progress.font_size, 20);

        delete_book(&conn, book.id).unwrap();
        assert!(book_by_id(&conn, book.id).unwrap().is_none());
        assert!(list_books(&conn).unwrap().is_empty());
    }
}
