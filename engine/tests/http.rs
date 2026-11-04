//! HTTP-level tests. These drive the real router through `tower::oneshot`,
//! so a routing, auth, or status-code regression fails here rather than in
//! production.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;
use zaino_engine::api::{router, AppState};
use zaino_engine::search::SearchIndex;

fn state(token: &str) -> AppState {
    AppState {
        index: Arc::new(SearchIndex::in_ram().unwrap()),
        token: token.to_string(),
        max_upload_bytes: 5 * 1024 * 1024,
    }
}

/// Build a multipart body without pulling in a client crate.
fn multipart(filename: &str, content: &[u8]) -> (String, Vec<u8>) {
    let boundary = "----zainotestboundary";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n").as_bytes(),
    );
    body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
    body.extend_from_slice(content);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

async fn send(app: axum::Router, req: Request<Body>) -> (StatusCode, serde_json::Value) {
    let res = app.oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), 10 * 1024 * 1024)
        .await
        .unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, json)
}

#[tokio::test]
async fn health_is_open_and_answers() {
    // A health check that needs a token cannot be used by a container
    // healthcheck, which has no secret.
    let app = router(state("secret"));
    let (status, json) = send(
        app,
        Request::get("/health").body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["ok"], true);
    assert_eq!(json["service"], "zaino-engine");
}

#[tokio::test]
async fn extract_requires_a_token() {
    let app = router(state("secret"));
    let (ct, body) = multipart("a.txt", b"hello");
    let (status, json) = send(
        app,
        Request::post("/extract")
            .header("content-type", ct)
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json["error"], "unauthorized");
}

#[tokio::test]
async fn a_wrong_token_is_rejected() {
    let app = router(state("secret"));
    let (ct, body) = multipart("a.txt", b"hello");
    let (status, _) = send(
        app,
        Request::post("/extract")
            .header("content-type", ct)
            .header("authorization", "Bearer wrong")
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn an_empty_configured_token_never_allows_everyone() {
    // Fail closed: `ENGINE_TOKEN=""` must not mean "no auth required".
    let app = router(state(""));
    let (ct, body) = multipart("a.txt", b"hello");
    let (status, _) = send(
        app,
        Request::post("/extract")
            .header("content-type", ct)
            .header("authorization", "Bearer ")
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn extracts_plain_text() {
    let app = router(state("secret"));
    let (ct, body) = multipart("notes.txt", b"the quota wall fired");
    let (status, json) = send(
        app,
        Request::post("/extract")
            .header("content-type", ct)
            .header("authorization", "Bearer secret")
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["kind"], "text");
    assert_eq!(json["text"], "the quota wall fired");
    assert_eq!(json["truncated"], false);
}

#[tokio::test]
async fn an_unsupported_file_is_415_not_500() {
    let app = router(state("secret"));
    let (ct, body) = multipart("thing.bin", b"PK\x03\x04nope");
    let (status, json) = send(
        app,
        Request::post("/extract")
            .header("content-type", ct)
            .header("authorization", "Bearer secret")
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_eq!(json["error"], "unsupported_type");
}

#[tokio::test]
async fn an_empty_file_is_422() {
    let app = router(state("secret"));
    let (ct, body) = multipart("empty.txt", b"");
    let (status, json) = send(
        app,
        Request::post("/extract")
            .header("content-type", ct)
            .header("authorization", "Bearer secret")
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json["error"], "empty");
}

#[tokio::test]
async fn multipart_without_a_file_part_is_a_400() {
    let app = router(state("secret"));
    let body = "--b\r\nContent-Disposition: form-data; name=\"other\"\r\n\r\nx\r\n--b--\r\n";
    let (status, json) = send(
        app,
        Request::post("/extract")
            .header("content-type", "multipart/form-data; boundary=b")
            .header("authorization", "Bearer secret")
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["error"], "no_file");
}

#[tokio::test]
async fn search_round_trips_through_http() {
    let app = router(state("secret"));
    let index_body = serde_json::json!({
        "conversation_id": "c1",
        "org_id": "org-a",
        "user_id": "user-1",
        "title": "Quota wall",
        "body": "the blended token quota hit the ceiling",
        "created_at": "2026-11-01"
    });

    let (status, _) = send(
        app.clone(),
        Request::post("/index")
            .header("content-type", "application/json")
            .header("authorization", "Bearer secret")
            .body(Body::from(index_body.to_string()))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let search_body = serde_json::json!({
        "query": "quota",
        "org_id": "org-a",
        "user_id": "user-1"
    });
    let (status, json) = send(
        app,
        Request::post("/search")
            .header("content-type", "application/json")
            .header("authorization", "Bearer secret")
            .body(Body::from(search_body.to_string()))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["hits"][0]["conversation_id"], "c1");
}

#[tokio::test]
async fn search_refuses_a_missing_tenant() {
    // The defence against "someone forgot to pass the org".
    let app = router(state("secret"));
    let body = serde_json::json!({ "query": "quota", "org_id": "", "user_id": "user-1" });
    let (status, json) = send(
        app,
        Request::post("/search")
            .header("content-type", "application/json")
            .header("authorization", "Bearer secret")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["error"], "no_tenant");
}

#[tokio::test]
async fn delete_removes_the_document() {
    let app = router(state("secret"));
    let index_body = serde_json::json!({
        "conversation_id": "c9",
        "org_id": "org-a",
        "user_id": "user-1",
        "title": "doomed",
        "body": "ephemeral words",
        "created_at": "2026-11-01"
    });
    send(
        app.clone(),
        Request::post("/index")
            .header("content-type", "application/json")
            .header("authorization", "Bearer secret")
            .body(Body::from(index_body.to_string()))
            .unwrap(),
    )
    .await;

    let (status, _) = send(
        app.clone(),
        Request::delete("/index/c9")
            .header("authorization", "Bearer secret")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let search_body = serde_json::json!({
        "query": "ephemeral", "org_id": "org-a", "user_id": "user-1"
    });
    let (_, json) = send(
        app,
        Request::post("/search")
            .header("content-type", "application/json")
            .header("authorization", "Bearer secret")
            .body(Body::from(search_body.to_string()))
            .unwrap(),
    )
    .await;
    assert!(json["hits"].as_array().unwrap().is_empty());
}
