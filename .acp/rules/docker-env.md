---
paths: [compose.yaml, Dockerfile, docs/guides/docker.md]
keywords: [docker, container, compose]
check: docker compose up -d --build && docker compose ps
learned-from: pull request 1
---
A local `.env` is usually written for running ACP outside Docker (for
example `ACP_DATA_DIR=.data`). Inside the container the file system is
read-only except `/var/lib/acp`, so those values must never win.

Keep the container's paths, host and port under `environment:` in
`compose.yaml`; it takes precedence over `env_file`. When testing a Docker
change, test it with such a `.env` present, not only with none.
