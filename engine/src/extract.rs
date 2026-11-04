//! Document extraction for the Zaino portal.
//!
//! WHY THIS IS RUST AND NOT NODE. Extraction is CPU-bound, untrusted-input,
//! and can panic. In Next.js it either blocks the event loop (a 200-page PDF
//! stalls every other request) or needs a worker per upload. Here it runs on
//! its own thread pool behind a request timeout, so a malformed file costs
//! one request instead of the process.
//!
//! WHY IT NEVER TOUCHES DISK. Every format is parsed from a `&[u8]` in
//! memory. Uploads are user content; a temp file is a leak waiting for the
//! first unhandled error path. `pdf-extract::extract_text_from_mem`,
//! `calamine::open_workbook_auto_from_rs`, and `zip::ZipArchive::new` all
//! read from `Read`, so nothing we parse needs a path.
//!
//! FAILURE IS TYPED, NOT A STRING. The portal decides whether to tell the
//! user "this PDF is encrypted" or "this file type is not supported", and
//! it cannot do that from an `anyhow` message.

use std::io::{Cursor, Read};

use serde::{Deserialize, Serialize};

/// Cap on extracted text. A 300-page PDF is not a chat attachment; keeping
/// the head and the tail preserves the abstract and the conclusion, which
/// is what a model actually reads.
pub const MAX_EXTRACTED_CHARS: usize = 200_000;

/// How much of a truncated document to keep from the end.
const TAIL_CHARS: usize = 40_000;

#[derive(Debug, thiserror::Error)]
pub enum ExtractError {
    #[error("unsupported file type: {0}")]
    UnsupportedType(String),
    #[error("file is encrypted and cannot be read")]
    Encrypted,
    #[error("file is malformed: {0}")]
    Malformed(String),
    #[error("file is too large: {size} bytes exceeds {limit}")]
    TooLarge { size: usize, limit: usize },
    #[error("document contains no extractable text")]
    Empty,
    #[error("extraction failed: {0}")]
    Failed(String),
}

/// What kind of content we found, so the portal can decide how to present it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExtractedKind {
    Text,
    Pdf,
    Docx,
    Sheet,
    Image,
}

impl ExtractedKind {
    /// Stable wire name the portal stores in `attachments.kind`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Pdf => "pdf",
            Self::Docx => "docx",
            Self::Sheet => "sheet",
            Self::Image => "image",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Extracted {
    pub kind: ExtractedKind,
    /// The text a model may read. Empty for images, which are passed as
    /// pixels and never as text.
    pub text: String,
    /// True when `text` was cut at `MAX_EXTRACTED_CHARS`.
    pub truncated: bool,
    /// Advisory, not authoritative: the client can lie about a MIME type,
    /// which is why `extract` sniffs magic bytes instead of trusting it.
    pub pages: Option<usize>,
}

/// Decide the format from the bytes, never from the client's MIME type.
///
/// A `.pdf` that is actually a zip must fail as a zip, not be reported as a
/// broken PDF. Magic-byte sniffing is the only signal the uploader cannot
/// forge without also making the file unparseable.
pub fn sniff(bytes: &[u8]) -> Option<ExtractedKind> {
    if bytes.len() < 4 {
        return None;
    }
    if bytes.starts_with(b"%PDF") {
        return Some(ExtractedKind::Pdf);
    }
    // PNG, JPEG, GIF, WebP: passed to a vision model as-is.
    if bytes.starts_with(&[0x89, b'P', b'N', b'G'])
        || bytes.starts_with(&[0xFF, 0xD8, 0xFF])
        || bytes.starts_with(b"GIF8")
        || (bytes.starts_with(b"RIFF") && bytes.len() > 11 && &bytes[8..12] == b"WEBP")
    {
        return Some(ExtractedKind::Image);
    }
    // OOXML (docx/xlsx) and legacy zip containers are both PK\x03\x04.
    // The extension disambiguates; see `extract_with_hint`.
    if bytes.starts_with(b"PK\x03\x04") {
        return None;
    }
    // Heuristic: valid UTF-8 with no NULs is text. CSV, JSON, logs, MD.
    if !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok() {
        return Some(ExtractedKind::Text);
    }
    None
}

/// Extract text from bytes, using the filename only to disambiguate
/// formats that share a container signature (docx vs xlsx are both zip).
pub fn extract(bytes: &[u8], filename: Option<&str>, max_bytes: usize) -> Result<Extracted, ExtractError> {
    if bytes.len() > max_bytes {
        return Err(ExtractError::TooLarge {
            size: bytes.len(),
            limit: max_bytes,
        });
    }
    if bytes.is_empty() {
        return Err(ExtractError::Empty);
    }

    let ext = filename
        .and_then(|f| f.rsplit('.').next())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    if let Some(kind) = sniff(bytes) {
        return match kind {
            ExtractedKind::Pdf => extract_pdf(bytes),
            ExtractedKind::Image => Ok(Extracted {
                kind: ExtractedKind::Image,
                text: String::new(),
                truncated: false,
                pages: None,
            }),
            ExtractedKind::Text => Ok(text_result(bytes, ExtractedKind::Text)),
            _ => unreachable!("sniff only returns Pdf, Image, or Text"),
        };
    }

    // Zip-based. The extension is the only way to tell docx from xlsx.
    match ext.as_str() {
        "docx" => extract_docx(bytes),
        "xlsx" | "xlsm" | "ods" => extract_sheet(bytes),
        "xls" if bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) => extract_sheet(bytes),
        _ => Err(ExtractError::UnsupportedType(if ext.is_empty() {
            "unknown".to_string()
        } else {
            ext
        })),
    }
}

fn text_result(bytes: &[u8], kind: ExtractedKind) -> Extracted {
    // Lossy is correct here: a stray Latin-1 byte in a log file should cost
    // one replacement character, not the whole document.
    let raw = String::from_utf8_lossy(bytes);
    let (text, truncated) = clamp(&raw);
    Extracted {
        kind,
        text,
        truncated,
        pages: None,
    }
}

/// Keep the head and the tail of an oversized document.
///
/// Truncating to the first N chars alone is the common mistake: for a long
/// report the conclusion — the part a user asks about — is at the end.
fn clamp(raw: &str) -> (String, bool) {
    let total = raw.chars().count();
    if total <= MAX_EXTRACTED_CHARS {
        return (raw.to_string(), false);
    }
    let head: String = raw.chars().take(MAX_EXTRACTED_CHARS - TAIL_CHARS).collect();
    let tail: String = raw
        .chars()
        .skip(total.saturating_sub(TAIL_CHARS))
        .collect();
    (
        format!("{head}\n\n[...{total} characters total; middle omitted...]\n\n{tail}"),
        true,
    )
}

fn extract_pdf(bytes: &[u8]) -> Result<Extracted, ExtractError> {
    match pdf_extract::extract_text_from_mem(bytes) {
        Ok(raw) => {
            let (text, truncated) = clamp(&raw);
            if text.trim().is_empty() {
                // A scanned PDF is images with no text layer. That is not a
                // failure to hide: the portal should offer OCR instead.
                return Err(ExtractError::Empty);
            }
            Ok(Extracted {
                kind: ExtractedKind::Pdf,
                text,
                truncated,
                pages: None,
            })
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.to_ascii_lowercase().contains("encrypt") {
                Err(ExtractError::Encrypted)
            } else {
                Err(ExtractError::Malformed(msg))
            }
        }
    }
}

fn read_zip(bytes: &[u8]) -> Result<zip::ZipArchive<Cursor<&[u8]>>, ExtractError> {
    zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| ExtractError::Malformed(e.to_string()))
}

fn extract_docx(bytes: &[u8]) -> Result<Extracted, ExtractError> {
    let mut archive = read_zip(bytes)?;
    let mut xml = String::new();
    {
        let mut entry = archive
            .by_name("word/document.xml")
            .map_err(|_| ExtractError::Malformed("not a Word document (no word/document.xml)".into()))?;
        entry
            .read_to_string(&mut xml)
            .map_err(|e| ExtractError::Malformed(e.to_string()))?;
    }
    let text = docx_xml_to_text(&xml)?;
    let (text, truncated) = clamp(&text);
    if text.trim().is_empty() {
        return Err(ExtractError::Empty);
    }
    Ok(Extracted {
        kind: ExtractedKind::Docx,
        text,
        truncated,
        pages: None,
    })
}

/// Word stores runs of text in `<w:t>` and paragraph/line breaks as empty
/// `<w:p>`/`<w:br/>`. Ignoring the breaks runs every paragraph together,
/// which makes the document unreadable to a model.
fn docx_xml_to_text(xml: &str) -> Result<String, ExtractError> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut out = String::with_capacity(xml.len() / 4);
    let mut in_text = false;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.name();
                let local = name.local_name();
                match local.as_ref() {
                    b"t" => in_text = true,
                    b"p" | b"br" | b"cr" => out.push('\n'),
                    b"tab" => out.push('\t'),
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                if e.name().local_name().as_ref() == b"t" {
                    in_text = false;
                }
            }
            Ok(Event::Text(t)) => {
                if in_text {
                    // `unescape`, not `decode`: Word escapes `&`/`<` as
                    // entities, and a model reading `&amp;` is reading
                    // markup instead of prose.
                    out.push_str(&t.unescape().map_err(|e| ExtractError::Malformed(e.to_string()))?);
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(ExtractError::Malformed(e.to_string())),
            _ => {}
        }
        buf.clear();
    }

    // Collapse the runs of blank lines Word leaves behind.
    let mut cleaned = String::with_capacity(out.len());
    let mut blank = 0usize;
    for line in out.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        cleaned.push_str(trimmed);
        cleaned.push('\n');
    }
    Ok(cleaned)
}

fn extract_sheet(bytes: &[u8]) -> Result<Extracted, ExtractError> {
    use calamine::{open_workbook_auto_from_rs, Data, Reader};

    let cursor = Cursor::new(bytes);
    let mut workbook = open_workbook_auto_from_rs(cursor)
        .map_err(|e| ExtractError::Malformed(e.to_string()))?;

    let sheets = workbook.sheet_names().to_owned();
    let mut out = String::new();
    let mut sheet_count = 0usize;

    for name in &sheets {
        let range = match workbook.worksheet_range(name) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if range.is_empty() {
            continue;
        }
        sheet_count += 1;
        out.push_str(&format!("# Sheet: {name}\n"));
        for row in range.rows() {
            let cells: Vec<String> = row
                .iter()
                .map(|c| match c {
                    Data::Empty => String::new(),
                    Data::String(s) => s.clone(),
                    Data::Float(f) => trim_float(*f),
                    Data::Int(i) => i.to_string(),
                    Data::Bool(b) => b.to_string(),
                    Data::DateTime(d) => d.to_string(),
                    Data::DateTimeIso(s) => s.clone(),
                    Data::DurationIso(s) => s.clone(),
                    Data::Error(e) => format!("#{e:?}"),
                })
                .collect();
            // Trailing empties are padding; dropping them keeps the CSV tidy.
            let end = cells.iter().rposition(|c| !c.is_empty()).map_or(0, |i| i + 1);
            if end == 0 {
                continue;
            }
            out.push_str(&cells[..end].join(","));
            out.push('\n');
        }
        out.push('\n');
        if out.chars().count() > MAX_EXTRACTED_CHARS * 2 {
            break;
        }
    }

    let (text, truncated) = clamp(&out);
    if text.trim().is_empty() {
        return Err(ExtractError::Empty);
    }
    Ok(Extracted {
        kind: ExtractedKind::Sheet,
        text,
        truncated,
        pages: Some(sheet_count),
    })
}

/// `3.0` should read as `3`, not `3.0`, or a sheet of integers looks wrong.
fn trim_float(f: f64) -> String {
    if f.fract() == 0.0 && f.abs() < 1e15 {
        format!("{}", f as i64)
    } else {
        format!("{f}")
    }
}

/// Extract a CSV by re-emitting it as clean rows, respecting the quoted
/// commas and newlines that a naive `split(',')` would corrupt.
pub fn extract_csv(bytes: &[u8]) -> Result<Extracted, ExtractError> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .has_headers(false)
        .from_reader(Cursor::new(bytes));

    let mut out = String::new();
    for record in reader.records() {
        let record = record.map_err(|e| ExtractError::Malformed(e.to_string()))?;
        let joined: Vec<&str> = record.iter().collect();
        out.push_str(&joined.join(","));
        out.push('\n');
        if out.chars().count() > MAX_EXTRACTED_CHARS * 2 {
            break;
        }
    }
    let (text, truncated) = clamp(&out);
    if text.trim().is_empty() {
        return Err(ExtractError::Empty);
    }
    Ok(Extracted {
        kind: ExtractedKind::Sheet,
        text,
        truncated,
        pages: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffs_pdf_by_magic_not_extension() {
        // A file named .pdf that is really text must be rejected as a PDF,
        // not reported as a corrupt one.
        assert_eq!(sniff(b"%PDF-1.7 foo"), Some(ExtractedKind::Pdf));
        assert_eq!(sniff(b"hello world"), Some(ExtractedKind::Text));
        assert_eq!(sniff(b""), None);
    }

    #[test]
    fn sniffs_images() {
        assert_eq!(sniff(&[0x89, b'P', b'N', b'G', 0, 0]), Some(ExtractedKind::Image));
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(ExtractedKind::Image));
        assert_eq!(sniff(b"GIF89a"), Some(ExtractedKind::Image));
        assert_eq!(sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 "), Some(ExtractedKind::Image));
    }

    #[test]
    fn binary_is_unsupported_not_garbage_text() {
        // A zip with an unknown extension must fail fast rather than emit
        // mojibake that the model would then "analyse".
        let err = extract(b"PK\x03\x04binary", Some("thing.bin"), 1_000_000).unwrap_err();
        assert!(matches!(err, ExtractError::UnsupportedType(_)));
    }

    #[test]
    fn rejects_oversized_and_empty() {
        let err = extract(b"abc", None, 2).unwrap_err();
        assert!(matches!(err, ExtractError::TooLarge { .. }));
        let err = extract(b"", None, 2).unwrap_err();
        assert!(matches!(err, ExtractError::Empty));
    }

    #[test]
    fn plain_text_passes_through_with_lossy_bytes() {
        let out = extract(b"hello\nworld", Some("a.txt"), 1_000).unwrap();
        assert_eq!(out.kind, ExtractedKind::Text);
        assert_eq!(out.text, "hello\nworld");
        assert!(!out.truncated);
    }

    #[test]
    fn truncation_keeps_head_and_tail() {
        // The tail is the part a user asks about, so it must survive.
        let body = format!("{}{}", "A".repeat(MAX_EXTRACTED_CHARS), "CONCLUSION");
        let (text, truncated) = clamp(&body);
        assert!(truncated);
        assert!(text.contains("CONCLUSION"));
        assert!(text.len() <= MAX_EXTRACTED_CHARS + 200);
    }

    #[test]
    fn docx_breaks_become_newlines() {
        let xml = r#"<w:document><w:body>
            <w:p><w:r><w:t>First</w:t></w:r></w:p>
            <w:p><w:r><w:t>Second</w:t></w:r></w:p>
        </w:body></w:document>"#;
        let text = docx_xml_to_text(xml).unwrap();
        assert!(text.contains("First"));
        assert!(text.contains("Second"));
        assert!(text.contains('\n'));
        // Paragraphs must not be concatenated into one word.
        assert!(!text.contains("FirstSecond"));
    }

    #[test]
    fn floats_render_without_spurious_decimals() {
        assert_eq!(trim_float(3.0), "3");
        assert_eq!(trim_float(3.5), "3.5");
    }

    #[test]
    fn csv_respects_quoted_commas() {
        let out = extract_csv(b"a,\"b,c\"\n1,2\n").unwrap();
        assert_eq!(out.kind, ExtractedKind::Sheet);
        assert!(out.text.contains("a,b,c"));
    }

    #[test]
    fn docx_without_document_xml_is_malformed_not_panic() {
        // Adversarial zip: valid container, wrong contents. Must be an
        // error, never a panic.
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
            w.start_file("other.txt", zip::write::SimpleFileOptions::default()).unwrap();
            std::io::Write::write_all(&mut w, b"nope").unwrap();
            w.finish().unwrap();
        }
        let err = extract(&buf, Some("evil.docx"), 1_000_000).unwrap_err();
        assert!(matches!(err, ExtractError::Malformed(_)));
    }
}
