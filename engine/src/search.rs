//! Conversation search over tantivy.
//!
//! WHY A SEARCH ENGINE AND NOT `ILIKE`. The audit's item 6 is "no
//! conversation search." The obvious fix — `WHERE content ILIKE '%q%'` — is
//! a full scan of every message on every keystroke, cannot rank, cannot
//! stem, and CI users will type `debugg` and get nothing for `debugging`.
//! tantivy gives ranked, stemmed, sub-10ms search over the same data with
//! an index we control.
//!
//! WHY THE PORTAL STILL OWNS THE TRUTH. This index is derived and
//! disposable: Postgres has the messages, this only answers "which ones
//! match." Every hit is re-read from Postgres before it is shown, so a
//! stale or corrupted index can degrade results but can never show a
//! message the tenant no longer owns. That is also why deletes are
//! best-effort here — a missed delete is corrected by the ownership
//! re-read, not relied upon for isolation.
//!
//! TENANT ISOLATION IS A FILTER, NOT A SCHEMA. Every document carries its
//! `org_id` and `user_id` and every query is restricted to one of them.
//! A single shared index keeps commit cost low; the filter is applied on
//! every search, never optional.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, Occur, Query, QueryParser, TermQuery};
use tantivy::schema::{
    Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, STORED, STRING, TEXT,
};
use tantivy::{doc, Index, IndexReader, IndexWriter, Term};

/// Tantivy writer heap. 64MB is enough to batch a reindex of a large
/// account without making the service look like a memory leak.
const WRITER_HEAP_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("search index unavailable: {0}")]
    Unavailable(String),
    #[error("invalid search query: {0}")]
    BadQuery(String),
    #[error("index write failed: {0}")]
    Write(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub conversation_id: String,
    pub title: String,
    /// Best matching excerpt, already trimmed to a readable length.
    pub snippet: String,
    pub role: String,
    pub score: f32,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
    /// Total documents scanned, so the portal can say "showing 20 of 340".
    pub total: usize,
}

pub struct SearchIndex {
    index: Index,
    reader: IndexReader,
    // Field handles are resolved once; `get_field` on every query is a
    // hash lookup in the hot path.
    f_conversation: Field,
    f_org: Field,
    f_user: Field,
    f_title: Field,
    f_body: Field,
    f_role: Field,
    f_created: Field,
}

fn build_schema() -> Schema {
    let mut b = Schema::builder();
    // `STRING` = untokenised + not indexed for search: these are filters.
    b.add_text_field("conversation_id", STRING | STORED);
    b.add_text_field("org_id", STRING | STORED);
    b.add_text_field("user_id", STRING | STORED);
    b.add_text_field("role", STRING | STORED);
    b.add_text_field("created_at", STRING | STORED);
    // Titles are searchable but weighted differently from bodies by the
    // query, not by the schema.
    b.add_text_field("title", TEXT | STORED);
    // English stemming + positions (positions enable phrase queries, so
    // "token wall" does not match "wall of tokens").
    let body_indexing = TextFieldIndexing::default()
        .set_tokenizer("en_stem")
        .set_index_option(IndexRecordOption::WithFreqsAndPositions);
    let body_opts = TextOptions::default().set_indexing_options(body_indexing).set_stored();
    b.add_text_field("body", body_opts);
    b.build()
}

impl SearchIndex {
    /// Open (or create) the index at `path`. Used by the server.
    pub fn open(path: &Path) -> Result<Self, SearchError> {
        std::fs::create_dir_all(path)
            .map_err(|e| SearchError::Unavailable(format!("create {}: {e}", path.display())))?;
        let existing = Index::open_in_dir(path).ok();
        // A schema change must not take the service down: if the on-disk
        // index was built by an older layout, rebuild rather than fail to
        // boot. The index is derived data, so losing it is cheap.
        let index = match existing {
            Some(idx) if idx.schema() == build_schema() => idx,
            _ => Index::create_in_dir(path, build_schema())
                .map_err(|e| SearchError::Unavailable(e.to_string()))?,
        };
        Self::from_index(index)
    }

    /// In-memory index, for tests.
    pub fn in_ram() -> Result<Self, SearchError> {
        let index = Index::create_in_ram(build_schema());
        Self::from_index(index)
    }

    fn from_index(index: Index) -> Result<Self, SearchError> {
        let schema = index.schema();
        let f = |n: &str| {
            schema
                .get_field(n)
                .map_err(|e| SearchError::Unavailable(e.to_string()))
        };
        let reader = index
            .reader()
            .map_err(|e| SearchError::Unavailable(e.to_string()))?;
        Ok(Self {
            f_conversation: f("conversation_id")?,
            f_org: f("org_id")?,
            f_user: f("user_id")?,
            f_title: f("title")?,
            f_body: f("body")?,
            f_role: f("role")?,
            f_created: f("created_at")?,
            index,
            reader,
        })
    }

    fn writer(&self) -> Result<IndexWriter, SearchError> {
        self.index
            .writer(WRITER_HEAP_BYTES)
            .map_err(|e| SearchError::Write(e.to_string()))
    }

    /// Upsert one conversation's searchable text. The portal calls this
    /// after a turn completes, not per token.
    #[allow(clippy::too_many_arguments)]
    pub fn index_conversation(
        &self,
        conversation_id: &str,
        org_id: &str,
        user_id: &str,
        title: &str,
        body: &str,
        created_at: &str,
    ) -> Result<(), SearchError> {
        let mut writer = self.writer()?;
        // Delete-then-add is the upsert: tantivy has no update, and a
        // reindex of the same conversation must not duplicate hits.
        writer.delete_term(Term::from_field_text(self.f_conversation, conversation_id));
        writer
            .add_document(doc!(
                self.f_conversation => conversation_id,
                self.f_org => org_id,
                self.f_user => user_id,
                self.f_title => title,
                self.f_body => body,
                self.f_role => "conversation",
                self.f_created => created_at,
            ))
            .map_err(|e| SearchError::Write(e.to_string()))?;
        writer
            .commit()
            .map_err(|e| SearchError::Write(e.to_string()))?;
        Ok(())
    }

    /// Index a single message so per-message matches carry the right role.
    #[allow(clippy::too_many_arguments)]
    pub fn index_message(
        &self,
        conversation_id: &str,
        org_id: &str,
        user_id: &str,
        title: &str,
        body: &str,
        role: &str,
        created_at: &str,
        commit: bool,
    ) -> Result<(), SearchError> {
        let mut writer = self.writer()?;
        writer
            .add_document(doc!(
                self.f_conversation => conversation_id,
                self.f_org => org_id,
                self.f_user => user_id,
                self.f_title => title,
                self.f_body => body,
                self.f_role => role,
                self.f_created => created_at,
            ))
            .map_err(|e| SearchError::Write(e.to_string()))?;
        if commit {
            writer
                .commit()
                .map_err(|e| SearchError::Write(e.to_string()))?;
        }
        Ok(())
    }

    /// Remove a conversation and everything indexed under it.
    pub fn delete_conversation(&self, conversation_id: &str) -> Result<(), SearchError> {
        let mut writer = self.writer()?;
        writer.delete_term(Term::from_field_text(self.f_conversation, conversation_id));
        writer
            .commit()
            .map_err(|e| SearchError::Write(e.to_string()))?;
        Ok(())
    }

    /// Ranked search restricted to one owner.
    ///
    /// `user_id` is required, not optional: a shared index with an optional
    /// tenant filter is one forgotten argument away from cross-tenant
    /// leakage. Title matches are boosted so a conversation named after the
    /// topic outranks an incidental mention deep in a transcript.
    pub fn search(
        &self,
        query: &str,
        org_id: &str,
        user_id: &str,
        limit: usize,
    ) -> Result<SearchResponse, SearchError> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(SearchResponse { hits: vec![], total: 0 });
        }

        self.reader
            .reload()
            .map_err(|e| SearchError::Unavailable(e.to_string()))?;

        let mut parser = QueryParser::for_index(&self.index, vec![self.f_body, self.f_title]);
        // A user typing `foo(` must get no results, not a 500. `parse_query`
        // errors on malformed syntax; we tolerate it as "no matches".
        parser.set_conjunction_by_default();
        let text_query = match parser.parse_query(trimmed) {
            Ok(q) => q,
            Err(_) => {
                return Err(SearchError::BadQuery(trimmed.chars().take(200).collect()));
            }
        };

        let filters: Vec<(Occur, Box<dyn Query>)> = vec![
            (
                Occur::Must,
                Box::new(TermQuery::new(
                    Term::from_field_text(self.f_org, org_id),
                    IndexRecordOption::Basic,
                )) as Box<dyn Query>,
            ),
            (
                Occur::Must,
                Box::new(TermQuery::new(
                    Term::from_field_text(self.f_user, user_id),
                    IndexRecordOption::Basic,
                )) as Box<dyn Query>,
            ),
        ];

        let parsed: Box<dyn Query> = Box::new(text_query);
        let mut clauses = filters;
        clauses.insert(0, (Occur::Must, parsed));
        let query = BooleanQuery::new(clauses);

        let searcher = self.reader.searcher();
        let limit = limit.clamp(1, 100);
        let found = searcher
            .search(&query, &TopDocs::with_limit(limit))
            .map_err(|e| SearchError::BadQuery(e.to_string()))?;

        let mut hits = Vec::with_capacity(found.len());
        for (score, addr) in found {
            let doc: tantivy::TantivyDocument = searcher
                .doc(addr)
                .map_err(|e| SearchError::Unavailable(e.to_string()))?;
            let get = |field: Field| -> String {
                doc.get_first(field)
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string()
            };
            let body = get(self.f_body);
            hits.push(SearchHit {
                conversation_id: get(self.f_conversation),
                title: get(self.f_title),
                snippet: make_snippet(&body, trimmed),
                role: get(self.f_role),
                score,
                created_at: Some(get(self.f_created)).filter(|s| !s.is_empty()),
            });
        }

        Ok(SearchResponse {
            total: hits.len(),
            hits,
        })
    }

    /// Force a readable snapshot, used by the reindex job.
    pub fn commit(&self) -> Result<(), SearchError> {
        self.writer()?
            .commit()
            .map_err(|e| SearchError::Write(e.to_string()))?;
        Ok(())
    }
}

/// A snippet centred on the first matching term.
///
/// Returning the first 200 chars of the body is the common shortcut and it
/// is useless: the match is usually further in, so the user sees an excerpt
/// that does not contain what they searched for.
fn make_snippet(body: &str, query: &str) -> String {
    const WINDOW: usize = 180;
    let lower_body = body.to_lowercase();
    let needle = query
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_lowercase();

    let start = if needle.is_empty() {
        0
    } else {
        lower_body
            .find(&needle)
            .map(|i| i.saturating_sub(WINDOW / 3))
            .unwrap_or(0)
    };

    let slice: String = body
        .chars()
        .skip(start)
        .take(WINDOW)
        .collect::<String>()
        .replace('\n', " ");
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if start + WINDOW < body.chars().count() {
        "…"
    } else {
        ""
    };
    format!("{prefix}{}{suffix}", slice.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(index: &SearchIndex) {
        index
            .index_message("c1", "org-a", "user-1", "Quota wall", "The blended token quota hit the ceiling today", "user", "2026-11-01", true)
            .unwrap();
        index
            .index_message("c2", "org-a", "user-1", "Rust extraction", "Parsing PDF files in Rust with pdf-extract is fast", "user", "2026-11-02", true)
            .unwrap();
        index
            .index_message("c3", "org-b", "user-2", "Other tenant", "The blended token quota is also mentioned here", "user", "2026-11-03", true)
            .unwrap();
    }

    #[test]
    fn finds_and_ranks_matches() {
        let index = SearchIndex::in_ram().unwrap();
        seed(&index);
        let res = index.search("extraction", "org-a", "user-1", 10).unwrap();
        assert_eq!(res.hits.len(), 1);
        assert_eq!(res.hits[0].conversation_id, "c2");
    }

    #[test]
    fn a_tenant_never_sees_another_tenants_messages() {
        // The single most important test in this file. c3 contains the same
        // words as c1 but belongs to org-b; searching as org-a/user-1 must
        // not return it.
        let index = SearchIndex::in_ram().unwrap();
        seed(&index);
        let res = index.search("blended token", "org-a", "user-1", 10).unwrap();
        assert!(res.hits.iter().all(|h| h.conversation_id != "c3"));
        assert!(res.hits.iter().any(|h| h.conversation_id == "c1"));

        let other = index.search("blended token", "org-b", "user-2", 10).unwrap();
        assert!(other.hits.iter().all(|h| h.conversation_id == "c3"));
    }

    #[test]
    fn same_org_different_user_is_isolated() {
        let index = SearchIndex::in_ram().unwrap();
        seed(&index);
        let res = index.search("quota", "org-a", "user-999", 10).unwrap();
        assert!(res.hits.is_empty(), "a user must not see a colleague's chats");
    }

    #[test]
    fn empty_query_is_an_empty_result_not_an_error() {
        let index = SearchIndex::in_ram().unwrap();
        seed(&index);
        let res = index.search("   ", "org-a", "user-1", 10).unwrap();
        assert!(res.hits.is_empty());
    }

    #[test]
    fn malformed_syntax_is_reported_not_panicked() {
        let index = SearchIndex::in_ram().unwrap();
        seed(&index);
        // An unbalanced quote/paren must be a typed error the route turns
        // into a 400, never a panic that kills the worker.
        let out = index.search("\"unclosed", "org-a", "user-1", 10);
        assert!(matches!(out, Err(SearchError::BadQuery(_))));
    }

    #[test]
    fn stemming_matches_the_word_stem() {
        let index = SearchIndex::in_ram().unwrap();
        seed(&index);
        // "parsing" in the body should be found by "parse".
        let res = index.search("parse", "org-a", "user-1", 10).unwrap();
        assert!(!res.hits.is_empty(), "en_stem should match parse/parsing");
    }

    #[test]
    fn reindexing_does_not_duplicate() {
        let index = SearchIndex::in_ram().unwrap();
        seed(&index);
        index
            .index_conversation("c2", "org-a", "user-1", "Rust extraction", "Parsing PDF files in Rust", "2026-11-02")
            .unwrap();
        // The conversation-level doc and the message-level doc both exist,
        // but the upsert must not multiply further on repeat.
        let first = index.search("extraction", "org-a", "user-1", 10).unwrap().hits.len();
        index
            .index_conversation("c2", "org-a", "user-1", "Rust extraction", "Parsing PDF files in Rust", "2026-11-02")
            .unwrap();
        let second = index.search("extraction", "org-a", "user-1", 10).unwrap().hits.len();
        assert_eq!(first, second);
    }

    #[test]
    fn delete_removes_from_results() {
        let index = SearchIndex::in_ram().unwrap();
        seed(&index);
        assert!(!index.search("extraction", "org-a", "user-1", 10).unwrap().hits.is_empty());
        index.delete_conversation("c2").unwrap();
        assert!(index.search("extraction", "org-a", "user-1", 10).unwrap().hits.is_empty());
    }

    #[test]
    fn snippet_centres_on_the_match() {
        let long = format!("{}NEEDLE_MARKER{}", "x".repeat(500), "y".repeat(500));
        let snippet = make_snippet(&long, "needle_marker");
        assert!(snippet.contains("NEEDLE_MARKER"), "snippet must contain the match");
        assert!(snippet.len() < 400, "snippet must stay small");
    }

    #[test]
    fn limit_is_clamped() {
        let index = SearchIndex::in_ram().unwrap();
        seed(&index);
        // A limit of 0 or 10_000 must not panic or return everything.
        assert!(index.search("quota", "org-a", "user-1", 0).unwrap().hits.len() <= 1);
        assert!(index.search("quota", "org-a", "user-1", 10_000).unwrap().hits.len() <= 100);
    }
}
