use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Cursor, Read};
use std::path::Path;

use quick_xml::Reader;
use quick_xml::escape::unescape;
use quick_xml::events::{BytesStart, Event};
use rusqlite::Connection;
use uuid::Uuid;
use zip::ZipArchive;

use crate::db;

#[derive(Debug, Default)]
struct Opf {
    title: String,
    author: String,
    spine: Vec<String>,
    manifest: HashMap<String, ManifestItem>,
    cover_id: Option<String>,
}

#[derive(Debug, Default)]
struct ManifestItem {
    id: String,
    href: String,
    media_type: String,
    properties: String,
}

pub fn import_epub(
    conn: &Connection,
    source: &Path,
    books_dir: &Path,
) -> Result<db::Book, String> {
    let file = File::open(source).map_err(|err| format!("无法读取 EPUB：{err}"))?;
    let mut archive = ZipArchive::new(file).map_err(|err| format!("无法打开 EPUB：{err}"))?;
    let opf_path = container_root_path(&mut archive)?;
    let opf_bytes = read_entry(&mut archive, &opf_path)?;
    let opf = parse_opf(&opf_bytes)?;
    let opf_dir = Path::new(&opf_path)
        .parent()
        .unwrap_or_else(|| Path::new(""));

    let mut chapters = Vec::new();
    for id in &opf.spine {
        let Some(item) = opf.manifest.get(id) else {
            continue;
        };
        let item_path = resolve_zip_path(opf_dir, &item.href);
        let bytes = match read_entry(&mut archive, &item_path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let (text, heading) = extract_xhtml_text(&bytes)?;
        let title = heading
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| title_from_path(&item.href));
        chapters.push((title, text));
    }
    if chapters.is_empty() {
        return Err("EPUB 中没有可解析的章节".to_string());
    }

    let uuid = Uuid::new_v4();
    let book_dir = books_dir.join(uuid.to_string());
    fs::create_dir_all(&book_dir).map_err(|err| format!("创建书籍目录失败：{err}"))?;

    let text_path = book_dir.join("book.txt");
    let mut content = String::new();
    let mut chapter_offsets = Vec::new();
    for (title, chapter_text) in &chapters {
        chapter_offsets.push((title.clone(), content.chars().count()));
        if !title.is_empty() && !chapter_text.trim_start().starts_with(title.trim()) {
            content.push_str(title.trim());
            content.push('\n');
        }
        content.push_str(chapter_text);
        if !content.ends_with('\n') {
            content.push('\n');
        }
        content.push('\n');
    }
    fs::write(&text_path, content.as_bytes())
        .map_err(|err| format!("写入 EPUB 正文失败：{err}"))?;

    let cover_path = match opf.cover_id.as_ref().and_then(|id| opf.manifest.get(id)) {
        Some(item) => {
            let cover_source = resolve_zip_path(opf_dir, &item.href);
            if let Ok(bytes) = read_entry(&mut archive, &cover_source) {
                let extension = mime_to_extension(&item.media_type);
                let cover_file = book_dir.join(format!("cover.{extension}"));
                fs::write(&cover_file, &bytes)
                    .map_err(|err| format!("写入 EPUB 封面失败：{err}"))?;
                Some(cover_file)
            } else {
                None
            }
        }
        None => None,
    };

    let source_size = source
        .metadata()
        .map_err(|err| format!("无法读取 EPUB 大小：{err}"))?
        .len() as i64;
    let title = if opf.title.is_empty() {
        source
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("未命名书籍")
            .to_string()
    } else {
        opf.title
    };

    let book = db::insert_book(
        conn,
        &title,
        &text_path,
        source_size,
        "UTF-8",
        content.chars().count() as i64,
        "epub",
        &cover_path
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
    )
    .inspect_err(|_| {
        let _ = fs::remove_dir_all(&book_dir);
    })?;

    db::replace_chapters(conn, book.id, &chapter_offsets)
        .inspect_err(|_| {
            let _ = fs::remove_dir_all(&book_dir);
        })?;
    Ok(book)
}

fn read_entry(archive: &mut ZipArchive<File>, name: &str) -> Result<Vec<u8>, String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|err| format!("EPUB 缺少文件 {name}：{err}"))?;
    let mut bytes = Vec::new();
    entry
        .read_to_end(&mut bytes)
        .map_err(|err| format!("读取 EPUB 文件 {name} 失败：{err}"))?;
    Ok(bytes)
}

fn local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|&byte| byte == b':').next().unwrap_or(name)
}

fn attr_value(element: &BytesStart<'_>, key: &[u8]) -> Option<String> {
    element.attributes().flatten().find_map(|attr| {
        if attr.key.as_ref() == key {
            let raw = std::str::from_utf8(attr.value.as_ref()).ok()?;
            unescape(raw).ok().map(|value| value.into_owned())
        } else {
            None
        }
    })
}

fn container_root_path(archive: &mut ZipArchive<File>) -> Result<String, String> {
    let bytes = read_entry(archive, "META-INF/container.xml")?;
    let mut reader = Reader::from_reader(Cursor::new(bytes));
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element) | Event::Empty(element)) => {
                if local_name(element.name().as_ref()) == b"rootfile" {
                    if let Some(path) = attr_value(&element, b"full-path") {
                        return Ok(path);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(err) => return Err(format!("解析 container.xml 失败：{err}")),
        }
        buffer.clear();
    }
    Err("EPUB container.xml 中没有 rootfile".to_string())
}

fn parse_opf(bytes: &[u8]) -> Result<Opf, String> {
    let mut reader = Reader::from_reader(Cursor::new(bytes));
    reader.config_mut().trim_text(true);
    let mut opf = Opf::default();
    let mut in_metadata = false;
    let mut in_manifest = false;
    let mut in_spine = false;
    let mut collecting: Option<Vec<u8>> = None;
    let mut text_buffer = String::new();
    let mut item: Option<ManifestItem> = None;
    let mut buffer = Vec::new();

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) => {
                let name = local_name(element.name().as_ref()).to_vec();
                match name.as_slice() {
                    b"metadata" => in_metadata = true,
                    b"manifest" => in_manifest = true,
                    b"spine" => in_spine = true,
                    _ => {}
                }
                handle_opf_start(
                    &mut opf,
                    &element,
                    &mut collecting,
                    &mut text_buffer,
                    &mut item,
                    in_metadata,
                    in_manifest,
                    in_spine,
                    false,
                );
            }
            Ok(Event::Empty(element)) => {
                let name = local_name(element.name().as_ref()).to_vec();
                match name.as_slice() {
                    b"metadata" => in_metadata = true,
                    b"manifest" => in_manifest = true,
                    b"spine" => in_spine = true,
                    _ => {}
                }
                handle_opf_start(
                    &mut opf,
                    &element,
                    &mut collecting,
                    &mut text_buffer,
                    &mut item,
                    in_metadata,
                    in_manifest,
                    in_spine,
                    true,
                );
            }
            Ok(Event::Text(text)) => {
                if collecting.is_some() {
                    if let Ok(value) = std::str::from_utf8(text.as_ref())
                        .map_err(|err| err.to_string())
                        .and_then(|value| unescape(value).map_err(|err| err.to_string()))
                    {
                        text_buffer.push_str(value.trim());
                    }
                }
            }
            Ok(Event::End(element)) => {
                let name = local_name(element.name().as_ref()).to_vec();
                match name.as_slice() {
                    b"metadata" => in_metadata = false,
                    b"manifest" => in_manifest = false,
                    b"spine" => in_spine = false,
                    b"item" if in_manifest => {
                        if let Some(item) = item.take() {
                            opf.manifest.insert(item.id.clone(), item);
                        }
                    }
                    b"title" if in_metadata => {
                        if opf.title.is_empty() {
                            opf.title = text_buffer.trim().to_string();
                        }
                        collecting = None;
                    }
                    b"creator" if in_metadata => {
                        if opf.author.is_empty() {
                            opf.author = text_buffer.trim().to_string();
                        }
                        collecting = None;
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析 EPUB OPF 失败：{err}")),
            _ => {}
        }
        buffer.clear();
    }
    Ok(opf)
}

fn handle_opf_start(
    opf: &mut Opf,
    element: &BytesStart<'_>,
    collecting: &mut Option<Vec<u8>>,
    text_buffer: &mut String,
    item: &mut Option<ManifestItem>,
    in_metadata: bool,
    in_manifest: bool,
    in_spine: bool,
    is_empty: bool,
) {
    let name = local_name(element.name().as_ref()).to_vec();
    match name.as_slice() {
        b"item" if in_manifest => {
            let manifest_item = ManifestItem {
                id: attr_value(element, b"id").unwrap_or_default(),
                href: attr_value(element, b"href").unwrap_or_default(),
                media_type: attr_value(element, b"media-type").unwrap_or_default(),
                properties: attr_value(element, b"properties").unwrap_or_default(),
            };
            if opf.cover_id.is_none()
                && manifest_item
                    .properties
                    .split_whitespace()
                    .any(|property| property == "cover-image")
            {
                opf.cover_id = Some(manifest_item.id.clone());
            }
            if is_empty {
                opf.manifest
                    .insert(manifest_item.id.clone(), manifest_item);
            } else {
                *item = Some(manifest_item);
            }
        }
        b"itemref" if in_spine => {
            if let Some(idref) = attr_value(element, b"idref") {
                opf.spine.push(idref);
            }
        }
        b"meta" if in_metadata => {
            if attr_value(element, b"name").as_deref() == Some("cover") {
                opf.cover_id = attr_value(element, b"content");
            }
        }
        b"title" | b"creator" if in_metadata => {
            *collecting = Some(name);
            text_buffer.clear();
        }
        _ => {}
    }
}

fn push_newline(text: &mut String) {
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
}

fn append_text(text: &mut String, value: &str) {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return;
    }
    if text.is_empty() {
        text.push_str(&normalized);
        return;
    }
    let last = text.chars().next_back().unwrap_or(' ');
    let first = normalized.chars().next().unwrap_or(' ');
    if last.is_ascii_alphanumeric() && first.is_ascii_alphanumeric() {
        text.push(' ');
    }
    text.push_str(&normalized);
}

fn extract_xhtml_text(bytes: &[u8]) -> Result<(String, Option<String>), String> {
    let mut reader = Reader::from_reader(Cursor::new(bytes));
    reader.config_mut().trim_text(true);
    let mut text = String::new();
    let mut skip_depth = 0usize;
    let mut in_head = false;
    let mut heading_tag: Option<Vec<u8>> = None;
    let mut heading_text = String::new();
    let mut chapter_title: Option<String> = None;
    let mut buffer = Vec::new();

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) => {
                let name = local_name(element.name().as_ref()).to_vec();
                match name.as_slice() {
                    b"head" => in_head = true,
                    b"script" | b"style" => skip_depth += 1,
                    b"h1" | b"h2" | b"h3" | b"h4" | b"h5" | b"h6" => {
                        heading_tag = Some(name);
                        heading_text.clear();
                        push_newline(&mut text);
                    }
                    b"p" | b"div" | b"li" | b"tr" | b"section" | b"blockquote" | b"article" => {
                        push_newline(&mut text);
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(element)) => {
                if local_name(element.name().as_ref()) == b"br" {
                    push_newline(&mut text);
                }
            }
            Ok(Event::Text(value)) => {
                if skip_depth > 0 || in_head {
                    continue;
                }
                let decoded = unescape(
                    std::str::from_utf8(value.as_ref())
                        .map_err(|err| format!("解析 XHTML 文本失败：{err}"))?,
                )
                .map_err(|err| format!("解析 XHTML 文本失败：{err}"))?
                .into_owned();
                if heading_tag.is_some() {
                    heading_text.push(' ');
                    heading_text.push_str(decoded.trim());
                }
                append_text(&mut text, &decoded);
            }
            Ok(Event::End(element)) => {
                let name = local_name(element.name().as_ref()).to_vec();
                match name.as_slice() {
                    b"head" => in_head = false,
                    b"script" | b"style" => {
                        skip_depth = skip_depth.saturating_sub(1);
                    }
                    b"h1" | b"h2" | b"h3" | b"h4" | b"h5" | b"h6" => {
                        let title = heading_text.trim();
                        if chapter_title.is_none() && !title.is_empty() {
                            chapter_title = Some(title.to_string());
                        }
                        heading_tag = None;
                        push_newline(&mut text);
                    }
                    b"p" | b"div" | b"li" | b"tr" | b"section" | b"blockquote" | b"article" => {
                        push_newline(&mut text);
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析 XHTML 失败：{err}")),
            _ => {}
        }
        buffer.clear();
    }
    Ok((text, chapter_title))
}

fn resolve_zip_path(base: &Path, href: &str) -> String {
    let decoded = href.replace("%20", " ").replace("%2F", "/");
    let joined = base.join(decoded.trim_start_matches('/'));
    joined.to_string_lossy().replace('\\', "/")
}

fn title_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("章节")
        .to_string()
}

fn mime_to_extension(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        _ => "img",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;

    #[test]
    fn imports_epub_with_chapters_and_cover() {
        let dir = tempdir().unwrap();
        let epub_path = dir.path().join("book.epub");
        let file = File::create(&epub_path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();

        archive
            .start_file("META-INF/container.xml", options)
            .unwrap();
        archive
            .write_all(
                "<?xml version=\"1.0\"?><container><rootfiles><rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles></container>".as_bytes(),
            )
            .unwrap();

        archive.start_file("OEBPS/content.opf", options).unwrap();
        archive
            .write_all(
                "<?xml version=\"1.0\"?><package><metadata><dc:title>测试书</dc:title></metadata><manifest><item id=\"c1\" href=\"chapter1.xhtml\" media-type=\"application/xhtml+xml\"/><item id=\"c2\" href=\"chapter2.xhtml\" media-type=\"application/xhtml+xml\"/><item id=\"cover\" href=\"cover.png\" media-type=\"image/png\" properties=\"cover-image\"/></manifest><spine><itemref idref=\"c1\"/><itemref idref=\"c2\"/></spine></package>".as_bytes(),
            )
            .unwrap();

        archive
            .start_file("OEBPS/chapter1.xhtml", options)
            .unwrap();
        archive
            .write_all(
                "<html><body><h1>第一章</h1><p>你好世界</p></body></html>".as_bytes(),
            )
            .unwrap();

        archive
            .start_file("OEBPS/chapter2.xhtml", options)
            .unwrap();
        archive
            .write_all(
                "<html><body><h1>第二章</h1><p>再见世界</p></body></html>".as_bytes(),
            )
            .unwrap();

        archive.start_file("OEBPS/cover.png", options).unwrap();
        archive.write_all(&[1, 2, 3]).unwrap();
        archive.finish().unwrap();

        let books_dir = dir.path().join("books");
        std::fs::create_dir_all(&books_dir).unwrap();
        let conn = db::open(&dir.path().join("test.db")).unwrap();
        let book = import_epub(&conn, &epub_path, &books_dir).unwrap();

        assert_eq!(book.format, "epub");
        assert!(!book.cover_path.is_empty());
        let text = std::fs::read_to_string(&book.file_path).unwrap();
        assert!(text.contains("你好世界"));
        assert!(text.contains("再见世界"));
        let chapters = db::list_chapters(&conn, book.id).unwrap();
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].title, "第一章");
        assert_eq!(chapters[1].title, "第二章");
    }
}
