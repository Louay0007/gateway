//! Config, boot, and graceful shutdown.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::api::AppState;
use crate::search::SearchIndex;

pub const DEFAULT_PORT: u16 = 8099;
pub const DEFAULT_MAX_UPLOAD: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub token: String,
    pub index_dir: PathBuf,
    pub max_upload_bytes: usize,
}

impl Config {
    /// Read the environment once, at boot.
    ///
    /// `ENGINE_TOKEN` is deliberately *not* defaulted: an engine with no
    /// token would accept every request from anything that can reach the
    /// port, and "it worked in dev" is how that ships. Fail closed.
    pub fn from_env() -> Result<Self, String> {
        let token = std::env::var("ENGINE_TOKEN").unwrap_or_default();
        if token.trim().is_empty() {
            return Err(
                "ENGINE_TOKEN is required — the engine parses untrusted documents and must \
                 not run unauthenticated"
                    .to_string(),
            );
        }

        let port = match std::env::var("ENGINE_PORT") {
            Ok(v) => v
                .parse::<u16>()
                .map_err(|_| format!("ENGINE_PORT must be a port number, got {v:?}"))?,
            Err(_) => DEFAULT_PORT,
        };

        let max_upload_bytes = match std::env::var("ENGINE_MAX_UPLOAD_BYTES") {
            Ok(v) => v
                .parse::<usize>()
                .map_err(|_| format!("ENGINE_MAX_UPLOAD_BYTES must be bytes, got {v:?}"))?,
            Err(_) => DEFAULT_MAX_UPLOAD,
        };

        let index_dir = PathBuf::from(
            std::env::var("ENGINE_INDEX_DIR").unwrap_or_else(|_| "/var/lib/zaino-engine/index".into()),
        );

        Ok(Self {
            port,
            token,
            index_dir,
            max_upload_bytes,
        })
    }
}

pub async fn run(config: Config) -> anyhow::Result<()> {
    let index = SearchIndex::open(&config.index_dir)
        .map_err(|e| anyhow::anyhow!("cannot open search index at {}: {e}", config.index_dir.display()))?;

    let state = AppState {
        index: Arc::new(index),
        token: config.token.clone(),
        max_upload_bytes: config.max_upload_bytes,
    };

    let app = crate::api::router(state).layer(
        // Conservative on purpose: an extraction is CPU-bound and a long
        // timeout lets one pathological file hold a blocking slot. The
        // portal retries rather than waiting past this.
        tower_http::timeout::TimeoutLayer::with_status_code(
            axum::http::StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(60),
        ),
    );

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| anyhow::anyhow!("cannot bind {addr}: {e}"))?;

    tracing::info!(
        %addr,
        index = %config.index_dir.display(),
        max_upload_bytes = config.max_upload_bytes,
        "zaino-engine listening"
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutting down");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Env is process-global, so these run serialised through one lock
    /// rather than fighting each other.
    fn with_env<F: FnOnce()>(vars: &[(&str, Option<&str>)], f: F) {
        use std::sync::Mutex;
        static LOCK: Mutex<()> = Mutex::new(());
        let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let saved: Vec<(&str, Option<String>)> = vars
            .iter()
            .map(|(k, _)| (*k, std::env::var(k).ok()))
            .collect();
        for (k, v) in vars {
            match v {
                Some(val) => std::env::set_var(k, val),
                None => std::env::remove_var(k),
            }
        }
        f();
        for (k, v) in saved {
            match v {
                Some(val) => std::env::set_var(k, val),
                None => std::env::remove_var(k),
            }
        }
    }

    #[test]
    fn missing_token_fails_closed() {
        with_env(&[("ENGINE_TOKEN", None)], || {
            let err = Config::from_env().unwrap_err();
            assert!(err.contains("ENGINE_TOKEN"));
        });
    }

    #[test]
    fn blank_token_is_rejected() {
        // Whitespace must not pass as a token, or `ENGINE_TOKEN=" "` would
        // authenticate whoever guesses it.
        with_env(&[("ENGINE_TOKEN", Some("   "))], || {
            assert!(Config::from_env().is_err());
        });
    }

    #[test]
    fn defaults_apply_when_optional_vars_are_absent() {
        with_env(
            &[
                ("ENGINE_TOKEN", Some("secret")),
                ("ENGINE_PORT", None),
                ("ENGINE_MAX_UPLOAD_BYTES", None),
            ],
            || {
                let c = Config::from_env().unwrap();
                assert_eq!(c.port, DEFAULT_PORT);
                assert_eq!(c.max_upload_bytes, DEFAULT_MAX_UPLOAD);
            },
        );
    }

    #[test]
    fn bad_port_is_a_clear_error_not_a_panic() {
        with_env(
            &[("ENGINE_TOKEN", Some("secret")), ("ENGINE_PORT", Some("not-a-port"))],
            || {
                let err = Config::from_env().unwrap_err();
                assert!(err.contains("ENGINE_PORT"));
            },
        );
    }
}
