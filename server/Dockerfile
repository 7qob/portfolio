# Two stages. The builder carries a C toolchain because better-sqlite3 and
# argon2 are native modules; the runtime does not, so none of that reaches the
# Pi. This is the main reason the API is containerised at all — compiling
# better-sqlite3 on a Raspberry Pi is slow and fails in interesting ways.

FROM node:22-alpine AS builder

WORKDIR /app

# node-gyp needs these to build the two native dependencies.
RUN apk add --no-cache python3 make g++

# Copied before the source so a source-only change reuses the install layer.
COPY package.json package-lock.json ./
RUN npm ci

# tsconfig.build.json is what excludes *.test.ts from the image: the tests
# are part of the repo and have no business in a running container.
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN npm run build \
 && npm prune --omit=dev


FROM node:22-alpine AS runtime

WORKDIR /app

# Node as PID 1 does not reap zombies or forward signals properly; tini does
# both, so `docker stop` actually stops rather than waits out the timeout.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/app.db \
    VAULT_FILES_DIR=/vault-files

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Both are bind-mounted in production; creating them keeps the image runnable
# on its own, which is what makes a smoke test possible before deploying.
RUN mkdir -p /data /vault-files \
 && chown -R node:node /data /app

# Never root. A traversal bug in a process running as root is a different
# category of problem to the same bug running as node.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
