# Run ACP with Docker

The quickest way to run ACP on your computer. You need
[Docker Desktop](https://www.docker.com/products/docker-desktop/) (macOS,
Windows) or Docker Engine (Linux).

## 1. Start it

```bash
git clone https://github.com/henryuks129/agent-control-plane.git
cd agent-control-plane
docker compose up -d
```

The first run builds the image, which takes a minute or two. Then open
<http://127.0.0.1:4317>.

## 2. Check it is healthy

```bash
docker compose ps
```

The `STATUS` column says `healthy` once ACP answers on `/healthz`. Docker
checks this every 30 seconds.

## 3. Add settings (optional)

ACP runs without any settings. To use a model provider or change limits,
create a file called `.env` next to `compose.yaml`:

| Setting | What it does | Default |
|---|---|---|
| `NVIDIA_API_KEY` | Key for NVIDIA's free model tier | empty (no live model calls) |
| `NVIDIA_BASE_URL` | NVIDIA API address | `https://integrate.api.nvidia.com/v1` |
| `ACP_SECRET_ENCRYPTION_KEY` | Encrypts saved credentials. Make one with `openssl rand -base64 32` | empty |
| `ACP_MAX_CONCURRENCY` | Tasks running at once | `4` |
| `ACP_REQUEST_TIMEOUT_MS` | How long to wait for a model | `45000` |
| `CODERABBIT_ENABLED` | Use CodeRabbit in review | `false` |

Then restart: `docker compose up -d`.

Inside Docker, ACP's data folder, port and address are fixed by
`compose.yaml` and ignore `ACP_DATA_DIR`, `ACP_ARTIFACTS_DIR`,
`ACP_WORKTREE_DIR`, `ACP_UI_HOST` and `ACP_UI_PORT` from `.env`. Those
settings are for running ACP without Docker.

`.env` stays on your computer. It is listed in `.gitignore` and
`.dockerignore`, so it is never committed or copied into the image.

## 4. Stop, update, remove

| To | Run |
|---|---|
| Stop | `docker compose down` |
| See logs | `docker compose logs -f` |
| Update | `git pull && docker compose up -d --build` |
| Delete all ACP data | `docker compose down -v` (cannot be undone) |

## How the container is locked down

- **Only your computer can reach it.** The port is bound to `127.0.0.1`. Do
  not change this unless you put something with sign-in in front of ACP.
- **Runs as a normal user**, not root, with every Linux capability dropped
  and no way to gain new privileges.
- **Read-only file system.** ACP can write only to its data volume
  (`/var/lib/acp`) and to `/tmp`.
- **Data survives restarts** in the `acp-data` volume.
