//! HTTP surface for the engine.
//!
//! Authentication is a shared token, not a JWT: the only caller is the
//! portal on the compose network, and a token that never leaves the private
//! network is the smallest thing that prevents a misconfigured port from
//! becoming an open document parser. The portal still enforces tenancy —
//! this service has no user context and must never be reachable publicly.

use std::sync::Arc;

use axum::{
    extract::{DefaultBodyLimit, Multipart, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::extract::{self, ExtractError};
use crate::search::{SearchError, SearchIndex};

#[derive(Clone)]
pub struct AppState {
    pub index: Arc<SearchIndex>,
    pub token: String,
    pub max_upload_bytes: usize,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: &'static str,
    message: String,
}

fn fail(status: StatusCode, code: &'static str, message: impl Into<String>) -> Response {
    (
        status,
        Json(ErrorBody {
            error: code,
            message: message.into(),
        }),
    )
        .into_response()
}

/// Map a typed extraction failure onto the status the portal branches on.
/// `422` for "we read it and there was nothing", `415` for "wrong format",
/// `413` for "too big" — the portal shows a different message for each.
impl IntoResponse for ExtractError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            ExtractError::UnsupportedType(_) => (StatusCode::UNSUPPORTED_MEDIA_TYPE, "unsupported_type"),
            ExtractError::Encrypted => (StatusCode::UNPROCESSABLE_ENTITY, "encrypted"),
            ExtractError::Malformed(_) => (StatusCode::UNPROCESSABLE_ENTITY, "malformed"),
            ExtractError::TooLarge { .. } => (StatusCode::PAYLOAD_TOO_LARGE, "too_large"),
            ExtractError::Empty => (StatusCode::UNPROCESSABLE_ENTITY, "empty"),
            ExtractError::Failed(_) => (StatusCode::INTERNAL_SERVER_ERROR, "failed"),
        };
        fail(status, code, self.to_string())
    }
}

impl IntoResponse for SearchError {
    fn into_response(self) -> Response {
        let status = match &self {
            SearchError::BadQuery(_) => StatusCode::BAD_REQUEST,
            _ => StatusCode::SERVICE_UNAVAILABLE,
        };
        fail(status, "search_unavailable", self.to_string())
    }
}

pub fn router(state: AppState) -> Router {
    let max = state.max_upload_bytes;
    Router::new()
        .route("/health", get(health))
        .route("/extract", post(extract_handler))
        .route("/search", post(search_handler))
        .route("/index", post(index_handler))
        .route("/index/{id}", delete(delete_handler))
        // The body limit must be set explicitly: axum's 2MB default would
        // reject a legitimate PDF before our own, better error fires.
        .layer(DefaultBodyLimit::max(max + 1024 * 1024))
        .with_state(state)
}

async fn health(State(s): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "service": "zaino-engine",
        "version": env!("CARGO_PKG_VERSION"),
        "maxUploadBytes": s.max_upload_bytes,
    }))
}

/// Bearer-token check. Constant comparison is not needed at this scale, but
/// an empty configured token must never mean "allow all".
fn authorized(header: Option<&axum::http::HeaderValue>, token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    header
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|v| v == token)
        .unwrap_or(false)
}

#[derive(Debug, Serialize)]
struct ExtractResponse {
    kind: &'static str,
    text: String,
    truncated: bool,
    pages: Option<usize>,
    chars: usize,
    filename: Option<String>,
}

/// `POST /extract` — multipart with one `file` part.
///
/// Extraction runs on the blocking pool: parsing a 200-page PDF is
/// CPU-bound, and doing it on a runtime worker would stall every other
/// request in the process. `spawn_blocking` is the whole reason this
/// service exists instead of a Node route.
async fn extract_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    mut multipart: Multipart,
) -> Response {
    if !authorized(headers.get(axum::http::header::AUTHORIZATION), &state.token) {
        return fail(StatusCode::UNAUTHORIZED, "unauthorized", "missing or invalid bearer token");
    }

    let mut file_bytes: Option<Vec<u8>> = None;
    let mut filename: Option<String> = None;

    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                return fail(StatusCode::BAD_REQUEST, "bad_multipart", e.to_string());
            }
        };
        if field.name() != Some("file") {
            continue;
        }
        filename = field.file_name().map(|s| s.to_string());
        match field.bytes().await {
            Ok(b) => file_bytes = Some(b.to_vec()),
            Err(e) => return fail(StatusCode::BAD_REQUEST, "bad_multipart", e.to_string()),
        }
    }

    let Some(bytes) = file_bytes else {
        return fail(StatusCode::BAD_REQUEST, "no_file", "multipart body had no `file` part");
    };

    let max = state.max_upload_bytes;
    let name = filename.clone();
    // A panic inside a third-party parser must not kill the server; it
    // surfaces as a 500 on this request only.
    let parsed = tokio::task::spawn_blocking(move || extract::extract(&bytes, name.as_deref(), max))
        .await
        .map_err(|e| fail(StatusCode::INTERNAL_SERVER_ERROR, "panic", e.to_string()));

    let parsed = match parsed {
        Ok(result) => result,
        Err(resp) => return resp,
    };

    match parsed {
        Ok(out) => {
            let chars = out.text.chars().count();
            Json(ExtractResponse {
                kind: out.kind.as_str(),
                text: out.text,
                truncated: out.truncated,
                pages: out.pages,
                chars,
                filename,
            })
            .into_response()
        }
        Err(e) => e.into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct SearchRequest {
    query: String,
    org_id: String,
    user_id: String,
    limit: Option<usize>,
}

/// `POST /search` — tenancy is required on every call.
async fn search_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<SearchRequest>,
) -> Response {
    if !authorized(headers.get(axum::http::header::AUTHORIZATION), &state.token) {
        return fail(StatusCode::UNAUTHORIZED, "unauthorized", "missing or invalid bearer token");
    }
    if req.org_id.trim().is_empty() || req.user_id.trim().is_empty() {
        // Refusing here, rather than defaulting, is what keeps a missing
        // filter from silently becoming a cross-tenant search.
        return fail(StatusCode::BAD_REQUEST, "no_tenant", "org_id and user_id are required");
    }

    let index = state.index.clone();
    let limit = req.limit.unwrap_or(20);
    let result = tokio::task::spawn_blocking(move || {
        index.search(&req.query, &req.org_id, &req.user_id, limit)
    })
    .await;

    match result {
        Ok(Ok(res)) => Json(res).into_response(),
        Ok(Err(e)) => e.into_response(),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, "panic", e.to_string()),
    }
}

#[derive(Debug, Deserialize)]
struct IndexRequest {
    conversation_id: String,
    org_id: String,
    user_id: String,
    title: String,
    body: String,
    created_at: String,
}

async fn index_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<IndexRequest>,
) -> Response {
    if !authorized(headers.get(axum::http::header::AUTHORIZATION), &state.token) {
        return fail(StatusCode::UNAUTHORIZED, "unauthorized", "missing or invalid bearer token");
    }
    let index = state.index.clone();
    let result = tokio::task::spawn_blocking(move || {
        index.index_conversation(
            &req.conversation_id,
            &req.org_id,
            &req.user_id,
            &req.title,
            &req.body,
            &req.created_at,
        )
    })
    .await;

    match result {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(e)) => e.into_response(),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, "panic", e.to_string()),
    }
}

async fn delete_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    if !authorized(headers.get(axum::http::header::AUTHORIZATION), &state.token) {
        return fail(StatusCode::UNAUTHORIZED, "unauthorized", "missing or invalid bearer token");
    }
    let index = state.index.clone();
    let result = tokio::task::spawn_blocking(move || index.delete_conversation(&id)).await;
    match result {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(e)) => e.into_response(),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, "panic", e.to_string()),
    }
}

/// Unused-import guard: `Query` is kept for future filter params.
#[allow(dead_code)]
fn _assert_query_type(_: Query<()>) {}
