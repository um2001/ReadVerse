use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use encoding_rs::{Decoder, Encoding};
use serde::Serialize;

pub const DEFAULT_PAGE_CHARS: usize = 900;
const DEFAULT_CHUNK_SIZE: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct Page {
    pub text: String,
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
                next_offset: start,
                eof: self.eof,
            });
        }

        self.advance_to(start)?;

        loop {
            let available = self.text.chars().count();
            if available >= target_chars {
                if let Some(end) = self.last_line_end(target_chars / 2, target_chars) {
                    return Ok(self.take(end));
                }
                if self.eof || available >= target_chars * 2 {
                    return Ok(self.take(target_chars));
                }
            } else if self.eof {
                return Ok(self.take(available));
            }
            self.read_more()?;
        }
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
}
