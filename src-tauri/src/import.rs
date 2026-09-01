use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Path;

use chardetng::EncodingDetector;
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use uuid::Uuid;

use rusqlite::Connection;

use crate::db::{self, Book};

const HEADER_SIZE: usize = 64 * 1024;
const CHUNK_SIZE: usize = 256 * 1024;

pub fn detect_encoding(header: &[u8]) -> &'static Encoding {
    if header.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return UTF_8;
    }
    if header.starts_with(&[0xFF, 0xFE]) {
        return UTF_16LE;
    }
    if header.starts_with(&[0xFE, 0xFF]) {
        return UTF_16BE;
    }
    let mut detector = EncodingDetector::new();
    detector.feed(header, true);
    let detected = detector.guess(None, true);
    if detected == UTF_8 && std::str::from_utf8(header).is_err() {
        encoding_rs::GBK
    } else {
        detected
    }
}

pub fn import_file(
    conn: &Connection,
    source: &Path,
    books_dir: &Path,
) -> Result<Book, String> {
    let is_txt = source
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("txt"))
        .unwrap_or(false);
    if !is_txt {
        return Err("仅支持导入 .txt 文件".to_string());
    }

    let metadata = fs::metadata(source).map_err(|err| format!("无法读取文件：{err}"))?;
    if !metadata.is_file() {
        return Err("请选择 TXT 文件".to_string());
    }

    let mut header_file = File::open(source).map_err(|err| err.to_string())?;
    let mut header = vec![0u8; HEADER_SIZE];
    let header_len = header_file
        .read(&mut header)
        .map_err(|err| err.to_string())?;
    let encoding = detect_encoding(&header[..header_len]);

    let destination = books_dir.join(format!("{}.txt", Uuid::new_v4()));
    let char_count = copy_and_count_chars(source, &destination, encoding)
        .map_err(|err| format!("复制书籍失败：{err}"))?;
    let title = source
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("未命名书籍")
        .to_string();

    db::insert_book(
        conn,
        &title,
        &destination,
        metadata.len() as i64,
        encoding.name(),
        char_count as i64,
    )
    .inspect_err(|_| {
        let _ = fs::remove_file(&destination);
    })
}

fn copy_and_count_chars(
    source: &Path,
    destination: &Path,
    encoding: &'static Encoding,
) -> Result<u64, std::io::Error> {
    let input = File::open(source)?;
    let mut reader = BufReader::with_capacity(CHUNK_SIZE, input);
    let output = File::create(destination)?;
    let mut writer = BufWriter::with_capacity(CHUNK_SIZE, output);
    let mut decoder = encoding.new_decoder_with_bom_removal();
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut char_count: u64 = 0;

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read])?;
        let mut decoded = String::with_capacity(CHUNK_SIZE * 2);
        let _ = decoder.decode_to_string(&buffer[..read], &mut decoded, false);
        char_count += decoded.chars().count() as u64;
    }

    let mut tail = String::new();
    let _ = decoder.decode_to_string(b"", &mut tail, true);
    char_count += tail.chars().count() as u64;

    writer.flush()?;
    Ok(char_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn detects_bom_and_gbk() {
        assert_eq!(detect_encoding(&[0xEF, 0xBB, 0xBF]), UTF_8);
        assert_eq!(detect_encoding(&[0xFF, 0xFE]), UTF_16LE);
        assert_eq!(detect_encoding(&[0xFE, 0xFF]), UTF_16BE);

        let gbk = encoding_rs::GBK.encode("第一章 相遇\n").0;
        let detected = detect_encoding(&gbk);
        assert_eq!(detected, encoding_rs::GBK);
    }

    #[test]
    fn copies_file_and_counts_gbk_chars() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("book.txt");
        let dest = dir.path().join("copy.txt");
        let content = "第一章\n这是中文内容。\n";
        let encoded = encoding_rs::GBK.encode(content).0;
        let mut file = File::create(&source).unwrap();
        file.write_all(&encoded).unwrap();

        let count = copy_and_count_chars(&source, &dest, encoding_rs::GBK).unwrap();
        assert_eq!(count, content.chars().count() as u64);
        let copied = fs::read(&dest).unwrap();
        assert_eq!(copied, encoded.as_ref());
    }

    #[test]
    fn rejects_non_txt_files() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("book.pdf");
        std::fs::write(&source, b"%PDF-1.4").unwrap();
        let books_dir = dir.path().join("books");
        std::fs::create_dir_all(&books_dir).unwrap();
        let conn = crate::db::open(&dir.path().join("test.db")).unwrap();

        let err = import_file(&conn, &source, &books_dir).unwrap_err();
        assert!(err.contains(".txt"));
    }
}
