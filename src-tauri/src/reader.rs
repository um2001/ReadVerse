use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use encoding_rs::{Decoder, Encoding};
use serde::Serialize;

pub const DEFAULT_PAGE_CHARS: usize = 900;
const DEFAULT_CHUNK_SIZE: usize = 256 * 1024;
const MAX_CHAPTER_TITLE_CHARS: usize = 80;
const MAX_LINE_BUFFER_CHARS: usize = 64 * 1024;
const SEARCH_BUFFER_CHARS: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct ChapterCandidate {
    pub title: String,
    pub char_offset: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub char_offset: usize,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Page {
    pub text: String,
    pub start_offset: usize,
    pub next_offset: usize,
    pub eof: bool,
}

pub struct Reader {
    path: PathBuf,
    encoding: &'static Encoding,
    file: File,
    decoder: Decoder,
    text: String,
    pos: usize,
    eof: bool,
    chunk_size: usize,
    page_starts: Vec<usize>,
    page_index_target: Option<usize>,
}

impl Reader {
    pub fn open(path: &Path, encoding: &'static Encoding) -> Result<Self, String> {
        let file = File::open(path).map_err(|err| format!("无法打开书籍：{err}"))?;
        Ok(Self {
            path: path.to_path_buf(),
            encoding,
            file,
            decoder: encoding.new_decoder_with_bom_removal(),
            text: String::new(),
            pos: 0,
            eof: false,
            chunk_size: DEFAULT_CHUNK_SIZE,
            page_starts: Vec::new(),
            page_index_target: None,
        })
    }

    #[cfg(test)]
    fn with_chunk_size(path: &Path, encoding: &'static Encoding, size: usize) -> Result<Self, String> {
        let mut reader = Self::open(path, encoding)?;
        reader.chunk_size = size;
        Ok(reader)
    }

    pub fn read_page(&mut self, start: usize, target_chars: usize) -> Result<Page, String> {
        if target_chars == 0 {
            return Ok(Page {
                text: String::new(),
                start_offset: start,
                next_offset: start,
                eof: self.eof,
            });
        }

        self.advance_to(start)?;

        loop {
            let available = self.text.chars().count();
            if available >= target_chars {
                if let Some(end) = self.last_line_end(target_chars / 2, target_chars) {
                    return Ok(Page {
                        start_offset: start,
                        ..self.take(end)
                    });
                }
                if self.eof || available >= target_chars * 2 {
                    return Ok(Page {
                        start_offset: start,
                        ..self.take(target_chars)
                    });
                }
            } else if self.eof {
                return Ok(Page {
                    start_offset: start,
                    ..self.take(available)
                });
            }
            self.read_more()?;
        }
    }

    pub fn previous_page(&mut self, end_offset: usize, target_chars: usize) -> Result<Page, String> {
        if end_offset == 0 {
            return Ok(Page {
                text: String::new(),
                start_offset: 0,
                next_offset: 0,
                eof: true,
            });
        }

        self.ensure_page_index(target_chars)?;
        let containing = self.page_starts.partition_point(|&start| start <= end_offset);
        if containing < 2 {
            return Ok(Page {
                text: String::new(),
                start_offset: 0,
                next_offset: 0,
                eof: true,
            });
        }
        let start = self.page_starts[containing - 2];
        Ok(self.read_page(start, target_chars)?)
    }

    pub fn page_number_at(&mut self, offset: usize, target_chars: usize) -> Result<usize, String> {
        if offset == 0 {
            return Ok(1);
        }
        self.ensure_page_index(target_chars)?;
        if self.page_starts.is_empty() {
            return Ok(1);
        }
        let containing = self.page_starts.partition_point(|&start| start <= offset);
        Ok(containing.clamp(1, self.page_starts.len()))
    }

    fn advance_to(&mut self, target: usize) -> Result<bool, String> {
        if target < self.pos {
            self.reset()
                .map_err(|err| format!("无法重读书籍：{err}"))?;
        }

        while self.pos < target {
            let need = target - self.pos;
            let available = self.text.chars().count();
            if available >= need {
                self.take(need);
                return Ok(true);
            }
            if self.eof {
                let available = self.text.chars().count();
                self.take(available);
                self.pos = target;
                return Ok(false);
            }
            self.read_more()?;
        }
        Ok(true)
    }

    fn read_more(&mut self) -> Result<(), String> {
        let mut buffer = vec![0u8; self.chunk_size];
        let read = self.file.read(&mut buffer).map_err(|err| err.to_string())?;
        if read == 0 {
            self.eof = true;
            return Ok(());
        }
        let mut decoded = String::with_capacity(self.chunk_size * 2);
        let _ = self.decoder.decode_to_string(&buffer[..read], &mut decoded, false);
        self.text.push_str(&decoded);
        Ok(())
    }

    fn last_line_end(&self, min: usize, max: usize) -> Option<usize> {
        let mut found = None;
        let mut char_index = 0usize;
        for (_, ch) in self.text.char_indices() {
            if ch == '\n' {
                let end = char_index + 1;
                if end >= min && end <= max {
                    found = Some(end);
                }
                if end > max {
                    break;
                }
            }
            char_index += 1;
        }
        found
    }

    fn take(&mut self, count: usize) -> Page {
        let byte_index = if count >= self.text.chars().count() {
            self.text.len()
        } else {
            self.text
                .char_indices()
                .nth(count)
                .map(|(index, _)| index)
                .unwrap_or(self.text.len())
        };
        let page = self.text[..byte_index].to_string();
        self.text.drain(..byte_index);
        self.pos += count;
        Page {
            text: page,
            start_offset: 0,
            next_offset: self.pos,
            eof: self.eof && self.text.is_empty(),
        }
    }

    fn reset(&mut self) -> std::io::Result<()> {
        self.file = File::open(&self.path)?;
        self.decoder = self.encoding.new_decoder_with_bom_removal();
        self.text.clear();
        self.pos = 0;
        self.eof = false;
        Ok(())
    }

    fn ensure_page_index(&mut self, target_chars: usize) -> Result<(), String> {
        if self.page_index_target == Some(target_chars) {
            return Ok(());
        }
        self.reset()
            .map_err(|err| format!("无法重读书籍：{err}"))?;
        self.page_starts.clear();
        let mut start = 0usize;
        loop {
            let page = self.read_page(start, target_chars)?;
            if page.text.is_empty() || page.next_offset <= start {
                break;
            }
            self.page_starts.push(start);
            start = page.next_offset;
        }
        self.page_index_target = Some(target_chars);
        Ok(())
    }
}

fn is_chapter_number_char(ch: char) -> bool {
    ch.is_ascii_digit() || "０１２３４５６７８９零〇一二三四五六七八九十百千万两".contains(ch)
}

fn is_chapter_title(line: &str) -> bool {
    let title = line.trim();
    let char_count = title.chars().count();
    if char_count == 0 || char_count > MAX_CHAPTER_TITLE_CHARS {
        return false;
    }

    if let Some(rest) = title.strip_prefix('第') {
        let mut seen_number = false;
        let mut chars = rest.chars().peekable();
        while let Some(&ch) = chars.peek() {
            if ch.is_whitespace() || is_chapter_number_char(ch) {
                seen_number = true;
                chars.next();
            } else {
                break;
            }
        }
        if seen_number {
            if let Some(&ch) = chars.peek() {
                if "章节回卷部篇集".contains(ch) {
                    return true;
                }
            }
        }
    }

    const PREFIXES: &[&str] = &[
        "序章", "序言", "楔子", "引子", "前言", "后记", "尾声", "番外", "外传", "正文",
    ];
    if PREFIXES.iter().any(|prefix| title.starts_with(prefix)) {
        return true;
    }

    for marker in ["卷", "部", "篇", "集"] {
        if let Some(rest) = title.strip_prefix(marker) {
            if rest
                .trim_start()
                .chars()
                .next()
                .map(is_chapter_number_char)
                .unwrap_or(false)
            {
                return true;
            }
        }
    }
    false
}

fn consume_scan_lines(
    text: &mut String,
    offset: &mut usize,
    chapters: &mut Vec<ChapterCandidate>,
    seen: &mut HashSet<String>,
) {
    loop {
        let Some(newline) = text.find('\n') else {
            break;
        };
        let raw_line = text[..newline].trim_end_matches('\r');
        let line = raw_line.trim();
        if is_chapter_title(line) && seen.insert(line.to_string()) {
            chapters.push(ChapterCandidate {
                title: line.to_string(),
                char_offset: *offset,
            });
        }
        let line_end = newline + 1;
        *offset += text[..line_end].chars().count();
        text.drain(..line_end);
    }
}

fn char_index_to_byte(text: &str, char_index: usize) -> usize {
    text.char_indices()
        .nth(char_index)
        .map(|(index, _)| index)
        .unwrap_or(text.len())
}

pub fn scan_chapters(
    path: &Path,
    encoding: &'static Encoding,
) -> Result<Vec<ChapterCandidate>, String> {
    let file = File::open(path).map_err(|err| format!("无法打开书籍：{err}"))?;
    let mut reader = BufReader::with_capacity(DEFAULT_CHUNK_SIZE, file);
    let mut decoder = encoding.new_decoder_with_bom_removal();
    let mut buffer = vec![0u8; DEFAULT_CHUNK_SIZE];
    let mut text = String::new();
    let mut offset = 0usize;
    let mut chapters = Vec::new();
    let mut seen = HashSet::new();

    loop {
        let read = reader.read(&mut buffer).map_err(|err| err.to_string())?;
        if read == 0 {
            let mut tail = String::new();
            let _ = decoder.decode_to_string(b"", &mut tail, true);
            text.push_str(&tail);
            consume_scan_lines(&mut text, &mut offset, &mut chapters, &mut seen);
            break;
        }
        let mut decoded = String::with_capacity(read * 2);
        let _ = decoder.decode_to_string(&buffer[..read], &mut decoded, false);
        text.push_str(&decoded);
        consume_scan_lines(&mut text, &mut offset, &mut chapters, &mut seen);

        if !text.contains('\n') && text.chars().count() > MAX_LINE_BUFFER_CHARS {
            let drop = text.chars().count() - MAX_LINE_BUFFER_CHARS;
            offset += drop;
            let drop_bytes = char_index_to_byte(&text, drop);
            text.drain(..drop_bytes);
        }
    }
    Ok(chapters)
}

fn make_search_snippet(text: &str, char_index: usize, query_len: usize, offset: usize) -> SearchHit {
    const CONTEXT: usize = 40;
    let total = text.chars().count();
    let start = char_index.saturating_sub(CONTEXT);
    let end = (char_index + query_len + CONTEXT * 2).min(total);
    let excerpt = text.chars().skip(start).take(end - start).collect::<String>();
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if end < total { "…" } else { "" };
    SearchHit {
        char_offset: offset + char_index,
        snippet: format!("{prefix}{excerpt}{suffix}"),
    }
}

fn collect_search_hits(
    text: &str,
    offset: usize,
    min_start: usize,
    query: &str,
    query_len: usize,
    searched_offset: &mut usize,
    results: &mut Vec<SearchHit>,
    limit: usize,
) {
    let total = text.chars().count();
    for (char_index, (byte_index, _)) in text.char_indices().enumerate() {
        if char_index < min_start {
            continue;
        }
        if char_index + query_len > total {
            break;
        }
        if !text[byte_index..].starts_with(query) {
            continue;
        }
        let global_offset = offset + char_index;
        if global_offset + query_len <= *searched_offset {
            continue;
        }
        results.push(make_search_snippet(text, char_index, query_len, offset));
        *searched_offset = global_offset + query_len;
        if results.len() >= limit {
            return;
        }
    }
}

pub fn search_file(
    path: &Path,
    encoding: &'static Encoding,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchHit>, String> {
    let query = query.trim();
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let query_len = query.chars().count();
    let file = File::open(path).map_err(|err| format!("无法打开书籍：{err}"))?;
    let mut reader = BufReader::with_capacity(DEFAULT_CHUNK_SIZE, file);
    let mut decoder = encoding.new_decoder_with_bom_removal();
    let mut buffer = vec![0u8; DEFAULT_CHUNK_SIZE];
    let mut text = String::new();
    let mut offset = 0usize;
    let mut searched_offset = 0usize;
    let mut results = Vec::new();

    loop {
        let read = reader.read(&mut buffer).map_err(|err| err.to_string())?;
        if read == 0 {
            let mut tail = String::new();
            let _ = decoder.decode_to_string(b"", &mut tail, true);
            text.push_str(&tail);
            let min_start = searched_offset
                .saturating_sub(offset)
                .saturating_sub(query_len.saturating_sub(1));
            collect_search_hits(
                &text,
                offset,
                min_start,
                query,
                query_len,
                &mut searched_offset,
                &mut results,
                limit,
            );
            break;
        }
        let mut decoded = String::with_capacity(read * 2);
        let _ = decoder.decode_to_string(&buffer[..read], &mut decoded, false);
        text.push_str(&decoded);

        let min_start = searched_offset
            .saturating_sub(offset)
            .saturating_sub(query_len.saturating_sub(1));
        collect_search_hits(
            &text,
            offset,
            min_start,
            query,
            query_len,
            &mut searched_offset,
            &mut results,
            limit,
        );
        searched_offset = searched_offset.max(offset + text.chars().count());

        if text.chars().count() > SEARCH_BUFFER_CHARS {
            let drop = text.chars().count() - SEARCH_BUFFER_CHARS;
            offset += drop;
            let drop_bytes = char_index_to_byte(&text, drop);
            text.drain(..drop_bytes);
        }
        if results.len() >= limit {
            break;
        }
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    fn write_text(path: &Path, bytes: &[u8]) {
        let mut file = File::create(path).unwrap();
        file.write_all(bytes).unwrap();
    }

    #[test]
    fn utf8_page_ends_on_line() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("book.txt");
        let content = "第一章\n这是第一页内容。\n这是第二页内容。\n";
        write_text(&path, content.as_bytes());

        let mut reader = Reader::open(&path, encoding_rs::UTF_8).unwrap();
        let page = reader.read_page(0, 50).unwrap();
        assert_eq!(page.text, content);
        assert_eq!(page.next_offset, page.text.chars().count());
        assert!(page.eof);
    }

    #[test]
    fn page_breaks_at_a_recent_line_boundary() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("lines.txt");
        let content = (0..12)
            .map(|index| format!("这是第{index}页内容\n"))
            .collect::<String>();
        write_text(&path, content.as_bytes());

        let mut reader = Reader::open(&path, encoding_rs::UTF_8).unwrap();
        let page = reader.read_page(0, 50).unwrap();
        assert!(page.text.ends_with('\n'));
        assert!(page.next_offset < content.chars().count());
        assert_eq!(
            page.text,
            content
                .chars()
                .take(page.text.chars().count())
                .collect::<String>()
        );
    }

    #[test]
    fn gbk_page_is_decoded_correctly() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("gbk.txt");
        let content = "第一章 风雪夜\n窗外开始下雪了。\n";
        let encoded = encoding_rs::GBK.encode(content).0;
        write_text(&path, &encoded);

        let mut reader = Reader::open(&path, encoding_rs::GBK).unwrap();
        let page = reader.read_page(0, 100).unwrap();
        assert_eq!(page.text, content);
        assert!(page.eof);
        assert!(!page.text.contains('\u{FFFD}'));
    }

    #[test]
    fn multibyte_characters_are_not_split_at_chunk_boundary() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("boundary.txt");
        let content = format!("{}界\n", "测".repeat(200));
        write_text(&path, content.as_bytes());

        let mut reader = Reader::with_chunk_size(&path, encoding_rs::UTF_8, 7).unwrap();
        let page = reader.read_page(0, 500).unwrap();
        assert_eq!(page.text, content);
        assert!(!page.text.contains('\u{FFFD}'));
    }

    #[test]
    fn reader_can_go_back_to_earlier_offset() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("back.txt");
        let content = "第一行\n第二行\n第三行\n";
        write_text(&path, content.as_bytes());

        let mut reader = Reader::open(&path, encoding_rs::UTF_8).unwrap();
        let first = reader.read_page(0, 10).unwrap();
        let next = reader.read_page(first.next_offset, 10).unwrap();
        assert_eq!(next.text, "第三行\n");

        let again = reader.read_page(0, 10).unwrap();
        assert_eq!(again.text, first.text);
        assert_eq!(again.next_offset, first.next_offset);
    }

    #[test]
    fn previous_page_restores_earlier_content_from_saved_offset() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("resume.txt");
        let content = (0..12)
            .map(|index| format!("这是第{index}页内容\n"))
            .collect::<String>();
        write_text(&path, content.as_bytes());

        let mut reader = Reader::open(&path, encoding_rs::UTF_8).unwrap();
        let first = reader.read_page(0, 50).unwrap();
        let second = reader.read_page(first.next_offset, 50).unwrap();
        assert!(second.start_offset > first.start_offset);

        let mut resumed = Reader::open(&path, encoding_rs::UTF_8).unwrap();
        let previous = resumed.previous_page(second.start_offset, 50).unwrap();
        assert_eq!(previous.text, first.text);
        assert_eq!(previous.start_offset, first.start_offset);
        assert_eq!(previous.next_offset, second.start_offset);
    }

    #[test]
    fn previous_page_skips_the_page_that_contains_a_mid_page_offset() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("resume-mid.txt");
        let content = (0..12)
            .map(|index| format!("这是第{index}页内容\n"))
            .collect::<String>();
        write_text(&path, content.as_bytes());

        let mut reader = Reader::open(&path, encoding_rs::UTF_8).unwrap();
        let first = reader.read_page(0, 50).unwrap();
        let second = reader.read_page(first.next_offset, 50).unwrap();
        let mid_offset = second.start_offset + 5;

        let mut resumed = Reader::open(&path, encoding_rs::UTF_8).unwrap();
        let previous = resumed.previous_page(mid_offset, 50).unwrap();
        assert_eq!(previous.text, first.text);
        assert_eq!(previous.next_offset, second.start_offset);
    }

    #[test]
    fn page_number_matches_forward_pagination() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("page-number.txt");
        let content = (0..12)
            .map(|index| format!("这是第{index}页内容\n"))
            .collect::<String>();
        write_text(&path, content.as_bytes());

        let mut reader = Reader::open(&path, encoding_rs::UTF_8).unwrap();
        let first = reader.read_page(0, 50).unwrap();
        let second = reader.read_page(first.next_offset, 50).unwrap();

        let mut resumed = Reader::open(&path, encoding_rs::UTF_8).unwrap();
        assert_eq!(resumed.page_number_at(0, 50).unwrap(), 1);
        assert_eq!(resumed.page_number_at(second.start_offset, 50).unwrap(), 2);

        let mid_offset = second.start_offset + 5;
        assert_eq!(resumed.page_number_at(mid_offset, 50).unwrap(), 2);
    }

    #[test]
    fn chapter_scan_detects_common_heading_patterns() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("chapters.txt");
        let content = "楔子\n第一章 相遇\n第一次见她\n卷二 风云\n第 3 章 夜行\n番外 星空\n";
        write_text(&path, content.as_bytes());

        let chapters = scan_chapters(&path, encoding_rs::UTF_8).unwrap();
        let titles = chapters
            .iter()
            .map(|chapter| chapter.title.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            titles,
            vec!["楔子", "第一章 相遇", "卷二 风云", "第 3 章 夜行", "番外 星空"]
        );
        assert_eq!(chapters[0].char_offset, 0);
        assert!(chapters[1].char_offset > chapters[0].char_offset);
        assert!(!titles.contains(&"第一次见她"));
    }

    #[test]
    fn search_file_returns_matches_across_long_lines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("search.txt");
        let content = format!("{}风雪继续写下去\n", "测".repeat(20000));
        write_text(&path, content.as_bytes());

        let hits = search_file(&path, encoding_rs::UTF_8, "风雪", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].char_offset, 20000);
        assert!(hits[0].snippet.contains("风雪"));
    }
}
