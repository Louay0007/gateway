//! Command entry point. Logging is set up here, before anything can fail,
//! so a boot error is reported through the same channel as a runtime one.

use zaino_engine::server::{self, Config};

fn main() -> anyhow::Result<()> {
    // `--version` is the container healthcheck. It must work WITHOUT the
    // environment being configured, so it is handled before env parsing —
    // otherwise a check against an engine that is up but has, say, no
    // index yet would report the process as unhealthy for the wrong reason.
    if std::env::args().any(|a| a == "--version" || a == "-V") {
        println!("zaino-engine {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "zaino_engine=info,tower_http=warn".into()),
        )
        .json()
        .init();

    let config = match Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("{e}");
            std::process::exit(2);
        }
    };

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    runtime.block_on(server::run(config))
}
