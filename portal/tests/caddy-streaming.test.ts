/**
 * Caddy must pass SSE routes through unbuffered and without a short timeout.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. The deploy pipeline does NOT run
 * `make verify-caddy` — there is no Caddy validation step in
 * `.github/workflows/deploy.yml`. A caddyfile syntax error therefore reaches
 * the VPS and fails at reload, and a *semantic* mistake (a streaming route
 * that silently misses the streaming proxy) reaches production and fails
 * quietly, which is worse.
 *
 * Both happened while adding the live-share stream:
 *
 *   1. `route /api/chat* /api/share/*` — a parse error, because `route`
 *      takes exactly ONE matcher expression. Found by running the real
 *      binary, not by reading.
 *   2. before that, /api/share/* was not in the matcher at all, so the live
 *      stream fell to the default proxy whose `read_timeout 120s` cuts the
 *      connection two minutes in — making the endpoint's own ten-minute cap
 *      unreachable and reconnecting every viewer silently.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CADDYFILE = readFileSync(resolve(__dirname, "../../config/Caddyfile"), "utf8");

/** The portal vhost block, so a matcher in another site does not count. */
function portalBlock(): string {
  const start = CADDYFILE.indexOf("{$CADDY_SCHEME:}{$PORTAL_DOMAIN}");
  expect(start, "the portal vhost is missing").toBeGreaterThan(-1);
  // Ends at the next site address at column 0.
  const rest = CADDYFILE.slice(start + 1);
  const next = rest.search(/\n\{\$CADDY_SCHEME:/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the SSE route matcher", () => {
  const portal = portalBlock();

  it("includes the live-share stream", () => {
    // Without this the stream is proxied by the default block below, whose
    // read_timeout is 120s.
    const matcher = /@streaming path ([^\n{]+)/.exec(portal);
    expect(matcher, "@streaming matcher missing").not.toBeNull();
    expect(matcher![1]).toContain("/api/chat*");
    expect(matcher![1]).toContain("/api/share/*");
  });

  it("uses a NAMED matcher, because `route` takes exactly one argument", () => {
    // `route /api/chat* /api/share/*` is a caddyfile parse error:
    //   "wrong argument count or unexpected line ending after ..."
    // caddy validate catches it; the deploy pipeline does not.
    expect(portal).toMatch(/@streaming path /);
    expect(portal).toMatch(/route @streaming \{/);
    expect(portal).not.toMatch(/route \/api\/chat\* \/api\/share\*/);
  });

  it("the streaming proxy disables buffering", () => {
    // Without `flush_interval -1` every token arrives in one burst at the
    // end, which is the whole reason the block exists.
    const block = portal.slice(portal.indexOf("route @streaming"));
    const nextRoute = block.indexOf("\n\treverse_proxy");
    const streaming = nextRoute === -1 ? block : block.slice(0, nextRoute);
    expect(streaming).toContain("flush_interval -1");
  });

  it("the streaming proxy has a timeout long enough for a 10-minute stream", () => {
    const block = portal.slice(portal.indexOf("route @streaming"));
    const nextRoute = block.indexOf("\n\treverse_proxy");
    const streaming = nextRoute === -1 ? block : block.slice(0, nextRoute);
    const read = /read_timeout (\d+)s/.exec(streaming);
    expect(read, "no read_timeout in the streaming block").not.toBeNull();
    // The route's own cap is 10 minutes; 120s (the default block) truncates.
    expect(Number(read![1])).toBeGreaterThanOrEqual(600);
  });

  it("the default proxy keeps its SHORT timeout", () => {
    // Widening everything would hide a hung handler behind a 15-minute wait.
    // The carve-out exists precisely so the default can stay tight.
    const after = portal.slice(portal.lastIndexOf("\n\treverse_proxy"));
    const read = /read_timeout (\d+)s/.exec(after);
    expect(read).not.toBeNull();
    expect(Number(read![1])).toBeLessThanOrEqual(300);
  });
});
