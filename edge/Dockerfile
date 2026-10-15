# auth-edge — the `zn-` → `sk-` prefix boundary in front of LiteLLM.
#
# Deliberately tiny and dependency-free: node:http only. A credential proxy
# is the last place to accept a supply-chain dependency, and a small image is
# one fewer thing to audit on every upgrade.
FROM node:22-alpine

WORKDIR /app
COPY server.mjs ./server.mjs

USER node

# Loopback only. The edge is reachable exclusively from Caddy on the same
# host; it must never be published on a routable interface.
ENV AUTH_EDGE_HOST=127.0.0.1 \
    AUTH_EDGE_PORT=4001 \
    AUTH_EDGE_UPSTREAM=http://127.0.0.1:4000

EXPOSE 4001

CMD ["node", "server.mjs"]