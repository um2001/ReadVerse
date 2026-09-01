use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct Book {
    pub id: i64,
    pub title: String,
    pub file_path: String,
    pub file_size: i64,
    pub encoding: String,
    pub char_count: i64,
    pub created_at: String,
    pub format: String,
    pub cover_path: String,
    pub missing: bool,
    pub last_char_offset: i64,
    pub font_size: i64,
    pub last_read_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadingProgress {
    pub book_id: i64,
    pub char_offset: i64,
    pub font_size: i64,
    pub encoding: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Chapter {
    pub id: i64,
    pub book_id: i64,
    pub title: String,
    pub char_offset: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Bookmark {
    pub id: i64,
    pub book_id: i64,
    pub char_offset: i64,
    pub excerpt: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub theme: String,
    pub font_family: String,
    pub line_height: String,
}

pub fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|err| err.to_string())?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
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

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|err| err.to_string())?;
    if version < 1 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chapters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                char_offset INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_chapters_book_offset
                ON chapters(book_id, char_offset);
            CREATE TABLE IF NOT EXISTS bookmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                char_offset INTEGER NOT NULL,
                excerpt TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_book_offset
                ON bookmarks(book_id, char_offset);
            PRAGMA user_version = 1;
            ",
        )
        .map_err(|err| err.to_string())?;
    }
    if version < 2 {
        conn.execute_batch(
            "
            ALTER TABLE books ADD COLUMN format TEXT NOT NULL DEFAULT 'txt';
            ALTER TABLE books ADD COLUMN cover_path TEXT NOT NULL DEFAULT '';
            ALTER TABLE reading_progress ADD COLUMN encoding TEXT NOT NULL DEFAULT 'auto';
            PRAGMA user_version = 2;
            ",
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(conn)
}

pub fn insert_book(
    conn: &Connection,
    title: &str,
    file_path: &Path,
    file_size: i64,
    encoding: &str,
    char_count: i64,
    format: &str,
    cover_path: &str,
) -> Result<Book, String> {
    conn.execute(
        "INSERT INTO books (title, file_path, file_size, encoding, char_count, format, cover_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            title,
            file_path.to_string_lossy(),
            file_size,
            encoding,
            char_count,
            format,
            cover_path
        ],
    )
    .map_err(|err| err.to_string())?;
    book_by_id(conn, conn.last_insert_rowid())?
        .ok_or_else(|| "导入失败：书籍记录不存在".to_string())
}

pub fn book_by_id(conn: &Connection, id: i64) -> Result<Option<Book>, String> {
    conn.query_row(
        "SELECT b.id, b.title, b.file_path, b.file_size,
                COALESCE(NULLIF(NULLIF(p.encoding, ''), 'auto'), b.encoding),
                b.char_count, b.created_at, b.format, b.cover_path,
                COALESCE(p.char_offset, 0), COALESCE(p.font_size, 18),
                COALESCE(p.updated_at, '')
         FROM books b
         LEFT JOIN reading_progress p ON p.book_id = b.id
         WHERE b.id = ?1",
        params![id],
        book_from_row,
    )
    .optional()
    .map_err(|err| err.to_string())
}

pub fn list_books(conn: &Connection) -> Result<Vec<Book>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT b.id, b.title, b.file_path, b.file_size,
                    COALESCE(NULLIF(NULLIF(p.encoding, ''), 'auto'), b.encoding),
                    b.char_count, b.created_at, b.format, b.cover_path,
                    COALESCE(p.char_offset, 0), COALESCE(p.font_size, 18),
                    COALESCE(p.updated_at, '')
             FROM books b
             LEFT JOIN reading_progress p ON p.book_id = b.id
             ORDER BY COALESCE(NULLIF(p.updated_at, ''), '') DESC,
                      b.created_at DESC, b.id DESC",
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
            "SELECT book_id, char_offset, font_size, encoding, updated_at
             FROM reading_progress WHERE book_id = ?1",
            params![book_id],
            |row| {
                Ok(ReadingProgress {
                    book_id: row.get(0)?,
                    char_offset: row.get(1)?,
                    font_size: row.get(2)?,
                    encoding: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())?;
    Ok(progress.unwrap_or(ReadingProgress {
        book_id,
        char_offset: 0,
        font_size: 18,
        encoding: "auto".to_string(),
        updated_at: String::new(),
    }))
}

fn default_settings() -> Settings {
    Settings {
        theme: "light".to_string(),
        font_family: "默认".to_string(),
        line_height: "1.8".to_string(),
    }
}

fn read_setting(conn: &Connection, key: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())
    .map(|value| value.unwrap_or_default())
}

fn setting_or(value: String, default: &str) -> String {
    if value.is_empty() {
        default.to_string()
    } else {
        value
    }
}

fn write_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn get_settings(conn: &Connection) -> Result<Settings, String> {
    let defaults = default_settings();
    Ok(Settings {
        theme: setting_or(read_setting(conn, "theme")?, &defaults.theme),
        font_family: setting_or(read_setting(conn, "font_family")?, &defaults.font_family),
        line_height: setting_or(read_setting(conn, "line_height")?, &defaults.line_height),
    })
}

pub fn save_settings(conn: &Connection, settings: &Settings) -> Result<(), String> {
    write_setting(conn, "theme", &settings.theme)?;
    write_setting(conn, "font_family", &settings.font_family)?;
    write_setting(conn, "line_height", &settings.line_height)?;
    Ok(())
}

pub fn replace_chapters(
    conn: &Connection,
    book_id: i64,
    chapters: &[(String, usize)],
) -> Result<(), String> {
    conn.execute("DELETE FROM chapters WHERE book_id = ?1", params![book_id])
        .map_err(|err| err.to_string())?;
    let mut stmt = conn
        .prepare(
            "INSERT INTO chapters (book_id, title, char_offset)
             VALUES (?1, ?2, ?3)",
        )
        .map_err(|err| err.to_string())?;
    for (title, char_offset) in chapters {
        stmt.execute(params![book_id, title, *char_offset as i64])
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub fn list_chapters(conn: &Connection, book_id: i64) -> Result<Vec<Chapter>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, book_id, title, char_offset
             FROM chapters
             WHERE book_id = ?1
             ORDER BY char_offset ASC, id ASC",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![book_id], |row| {
            Ok(Chapter {
                id: row.get(0)?,
                book_id: row.get(1)?,
                title: row.get(2)?,
                char_offset: row.get(3)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub fn chapter_title_at(
    conn: &Connection,
    book_id: i64,
    char_offset: i64,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT title FROM chapters
         WHERE book_id = ?1 AND char_offset <= ?2
         ORDER BY char_offset DESC, id DESC
         LIMIT 1",
        params![book_id, char_offset],
        |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())
}

pub fn add_bookmark(
    conn: &Connection,
    book_id: i64,
    char_offset: i64,
    excerpt: &str,
) -> Result<Bookmark, String> {
    conn.execute(
        "INSERT INTO bookmarks (book_id, char_offset, excerpt)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(book_id, char_offset) DO UPDATE SET
            excerpt = excluded.excerpt,
            created_at = datetime('now')",
        params![book_id, char_offset, excerpt],
    )
    .map_err(|err| err.to_string())?;
    conn.query_row(
        "SELECT id, book_id, char_offset, excerpt, created_at
         FROM bookmarks
         WHERE book_id = ?1 AND char_offset = ?2",
        params![book_id, char_offset],
        |row| {
            Ok(Bookmark {
                id: row.get(0)?,
                book_id: row.get(1)?,
                char_offset: row.get(2)?,
                excerpt: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )
    .map_err(|err| err.to_string())
}

pub fn list_bookmarks(conn: &Connection, book_id: i64) -> Result<Vec<Bookmark>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, book_id, char_offset, excerpt, created_at
             FROM bookmarks
             WHERE book_id = ?1
             ORDER BY char_offset ASC, id ASC",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![book_id], |row| {
            Ok(Bookmark {
                id: row.get(0)?,
                book_id: row.get(1)?,
                char_offset: row.get(2)?,
                excerpt: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub fn delete_bookmark(conn: &Connection, bookmark_id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![bookmark_id])
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn save_progress(
    conn: &Connection,
    book_id: i64,
    char_offset: i64,
    font_size: i64,
    encoding: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO reading_progress (book_id, char_offset, font_size, encoding)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(book_id) DO UPDATE SET
            char_offset = excluded.char_offset,
            font_size = excluded.font_size,
            encoding = excluded.encoding,
            updated_at = datetime('now')",
        params![book_id, char_offset, font_size, encoding],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn book_from_row(row: &Row<'_>) -> rusqlite::Result<Book> {
    let file_path: String = row.get(2)?;
    Ok(Book {
        id: row.get(0)?,
        title: row.get(1)?,
        file_path: file_path.clone(),
        file_size: row.get(3)?,
        encoding: row.get(4)?,
        char_count: row.get(5)?,
        created_at: row.get(6)?,
        format: row.get(7)?,
        cover_path: row.get(8)?,
        missing: !Path::new(&file_path).is_file(),
        last_char_offset: row.get(9)?,
        font_size: row.get(10)?,
        last_read_at: row.get(11)?,
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
            "txt",
            "",
        )
        .unwrap();

        assert!(book.id > 0);
        assert_eq!(list_books(&conn).unwrap().len(), 1);

        save_progress(&conn, book.id, 42, 20, "GBK").unwrap();
        let progress = get_progress(&conn, book.id).unwrap();
        assert_eq!(progress.char_offset, 42);
        assert_eq!(progress.font_size, 20);
        assert_eq!(progress.encoding, "GBK");

        delete_book(&conn, book.id).unwrap();
        assert!(book_by_id(&conn, book.id).unwrap().is_none());
        assert!(list_books(&conn).unwrap().is_empty());
    }

    #[test]
    fn settings_chapters_and_bookmarks_roundtrip() {
        let dir = tempdir().unwrap();
        let conn = open(&dir.path().join("test.db")).unwrap();
        let book = insert_book(
            &conn,
            "设置测试",
            Path::new("C:\\books\\settings.txt"),
            1024,
            "UTF-8",
            120,
            "txt",
            "",
        )
        .unwrap();

        save_settings(
            &conn,
            &Settings {
                theme: "night".to_string(),
                font_family: "宋体".to_string(),
                line_height: "2.0".to_string(),
            },
        )
        .unwrap();
        let settings = get_settings(&conn).unwrap();
        assert_eq!(settings.theme, "night");
        assert_eq!(settings.font_family, "宋体");
        assert_eq!(settings.line_height, "2.0");

        replace_chapters(
            &conn,
            book.id,
            &[
                ("序章".to_string(), 0),
                ("第一章 开始".to_string(), 12),
            ],
        )
        .unwrap();
        let chapters = list_chapters(&conn, book.id).unwrap();
        assert_eq!(chapters.len(), 2);
        assert_eq!(
            chapter_title_at(&conn, book.id, 20).unwrap().as_deref(),
            Some("第一章 开始")
        );

        add_bookmark(&conn, book.id, 12, "第一章 开始").unwrap();
        add_bookmark(&conn, book.id, 88, "中间位置").unwrap();
        let bookmarks = list_bookmarks(&conn, book.id).unwrap();
        assert_eq!(bookmarks.len(), 2);
        assert_eq!(bookmarks[0].char_offset, 12);
        delete_bookmark(&conn, bookmarks[0].id).unwrap();
        assert_eq!(list_bookmarks(&conn, book.id).unwrap().len(), 1);
    }
}
