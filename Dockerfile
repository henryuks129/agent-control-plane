FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    ACP_DATA_DIR=/var/lib/acp \
    ACP_ARTIFACTS_DIR=/var/lib/acp/artifacts \
    ACP_WORKTREE_DIR=/var/lib/acp/worktrees \
    ACP_UI_HOST=0.0.0.0 \
    ACP_UI_PORT=4317
COPY package.json ./
COPY --from=build /app/dist ./dist
RUN mkdir -p /var/lib/acp/artifacts && chown -R node:node /app /var/lib/acp
USER node
EXPOSE 4317
# Docker marks the container unhealthy if the web interface stops answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4317/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/cli/main.js", "ui"]
