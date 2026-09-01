use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

use chardetng::EncodingDetector;
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use uuid::Uuid;

use rusqlite::Connection;

use crate::db::{self, Book};

const CHUNK_SIZE: usize = 256 * 1024;
const SAMPLE_SIZE: usize = 64 * 1024;

const ENCODING_CANDIDATES: [&str; 5] = ["UTF-8", "GBK", "GB2312", "Big5", "windows-1252"];

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
    if detected == UTF_8 {
        match std::str::from_utf8(header) {
            Ok(_) => UTF_8,
            Err(err) if err.error_len().is_none() => UTF_8,
            Err(_) => encoding_rs::GBK,
        }
    } else {
        detected
    }
}

fn read_sample(file: &mut File, position: u64, size: usize) -> std::io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(position))?;
    let mut buffer = vec![0u8; size];
    let mut read = 0usize;
    while read < buffer.len() {
        let count = file.read(&mut buffer[read..])?;
        if count == 0 {
            break;
        }
        read += count;
    }
    buffer.truncate(read);
    Ok(buffer)
}

fn sample_replacement_ratio(encoding: &'static Encoding, sample: &[u8]) -> f64 {
    let (decoded, _, _) = encoding.decode(sample);
    let total = decoded.chars().count();
    if total == 0 {
        return 0.0;
    }
    let replacements = decoded.chars().filter(|ch| *ch == '\u{FFFD}').count();
    replacements as f64 / total as f64
}

fn is_clean_utf8_sample(sample: &[u8]) -> bool {
    let mut offset = 0usize;
    while offset < sample.len() {
        match std::str::from_utf8(&sample[offset..]) {
            Ok(_) => return true,
            Err(err) if err.error_len().is_none() => return true,
            Err(err) if err.valid_up_to() == 0 => {
                offset += 1;
            }
            Err(_) => return false,
        }
    }
    true
}

pub fn detect_encoding_from_file(path: &Path) -> Result<&'static Encoding, String> {
    let mut file = File::open(path).map_err(|err| format!("无法读取文件：{err}"))?;
    let file_len = file
        .metadata()
        .map_err(|err| err.to_string())?
        .len();

    let mut samples = Vec::new();
    if file_len <= SAMPLE_SIZE as u64 {
        samples.push(read_sample(&mut file, 0, SAMPLE_SIZE).map_err(|err| err.to_string())?);
    } else {
        let mut positions = vec![0u64, file_len / 4, file_len / 2, file_len * 3 / 4];
        positions.push(file_len.saturating_sub(SAMPLE_SIZE as u64));
        positions.sort_unstable();
        positions.dedup();
        for position in positions {
            samples.push(
                read_sample(&mut file, position, SAMPLE_SIZE).map_err(|err| err.to_string())?,
            );
        }
    }

    if let Some(first) = samples.first() {
        if first.starts_with(&[0xEF, 0xBB, 0xBF]) {
            return Ok(UTF_8);
        }
        if first.starts_with(&[0xFF, 0xFE]) {
            return Ok(UTF_16LE);
        }
        if first.starts_with(&[0xFE, 0xFF]) {
            return Ok(UTF_16BE);
        }
    }

    for label in ENCODING_CANDIDATES {
        let encoding = encoding_rs::Encoding::for_label(label.as_bytes())
            .ok_or_else(|| format!("不支持的编码：{label}"))?;
        let clean = if encoding == UTF_8 {
            samples.iter().all(|sample| is_clean_utf8_sample(sample))
        } else {
            samples
                .iter()
                .all(|sample| sample_replacement_ratio(encoding, sample) < 0.02)
        };
        if clean {
            return Ok(encoding);
        }
    }
    Ok(encoding_rs::WINDOWS_1252)
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

    let encoding = detect_encoding_from_file(source)?;

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
        "txt",
        "",
    )
    .inspect_err(|_| {
        let _ = fs::remove_file(&destination);
    })
}

pub fn export_file(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::copy(source, destination).map_err(|err| format!("导出失败：{err}"))?;
    Ok(())
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
    fn detects_utf8_when_sample_ends_with_incomplete_char() {
        let content = "第一章 中文内容\n".repeat(5000);
        let bytes = content.as_bytes();
        let truncated = &bytes[..bytes.len() - 1];
        assert_eq!(detect_encoding(truncated), UTF_8);
    }

    #[test]
    fn detects_gbk_over_windows_1252_for_chinese_files() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("gbk-large.txt");
        let prefix = "A".repeat(80_000);
        let content = format!("{prefix}\n第一章 中文内容\n");
        let encoded = encoding_rs::GBK.encode(&content).0;
        std::fs::write(&path, encoded).unwrap();

        let detected = detect_encoding_from_file(&path).unwrap();
        assert_eq!(detected, encoding_rs::GBK);
        assert_ne!(detected, encoding_rs::WINDOWS_1252);
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

    #[test]
    fn exports_copied_book_file() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("book.txt");
        let destination = dir.path().join("exported.txt");
        std::fs::write(&source, "导出的内容").unwrap();

        export_file(&source, &destination).unwrap();
        let expected = std::fs::read(&source).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), expected);
    }
}
