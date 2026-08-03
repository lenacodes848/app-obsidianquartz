# Public Knowledge Base

A personal knowledge graph published to the web. Notes are written in [Obsidian](https://obsidian.md/), version-controlled in this repo, and rendered as a static website using [Quartz v4](https://quartz.jzhao.xyz/). The site is served from a VPS behind Traefik and updates with a single `git push`.

All content covers topics found on the public internet — articles, concepts, and connections the owner finds worth keeping.

---

## How it works

```
Write in Obsidian  →  git push  →  VPS pulls & rebuilds Docker image  →  Live site
```

- **`md-notebook/`** — the Obsidian vault. All your notes live here as plain markdown files.
- **Quartz** turns those notes into a static site with wikilinks, backlinks, graph view, and search.
- **nginx** (inside a Docker container) serves the built HTML.
- **Traefik** (already running on the VPS) handles HTTPS and routes traffic to the container.
- **`kb-auth-service`** (another small container, `auth-service/`) gates every request behind a login page — password + security questions — before Traefik lets it through.

---

## Deploying to the VPS

See [`DEPLOY.md`](./DEPLOY.md) for the full step-by-step runbook. The short version:

1. Make sure the VPS is running Traefik with a Docker network named `proxy`.
2. Point a DNS A record at the VPS IP for your chosen subdomain.
3. Clone this repo onto the VPS, copy `.env.example` to `.env`, and fill in `DOMAIN` and `BASE_URL`.
4. Run `docker compose up -d --build`.

Traefik picks up the container automatically and issues a Let's Encrypt certificate.

---

## Adding content

### 1. Write in Obsidian

Open the `md-notebook/` folder as your Obsidian vault. Write notes normally — use `[[wikilinks]]` to connect ideas, add tags, and let the graph build itself over time.

A few conventions that keep the site tidy:

- Put an `index.md` at the root of `md-notebook/` — it becomes the homepage.
- Any note with `draft: true` in its frontmatter is excluded from the published site.
- Folders inside `md-notebook/` become sections; Quartz generates folder index pages automatically.

### 2. Commit and push

```bash
cd /path/to/app-obsidian-quartz
git add md-notebook/
git commit -m "add: <brief description of what you wrote>"
git push
```

That's it for the local side.

### 3. Update the live site

SSH into the VPS and run:

```bash
cd knowledge-base
git pull
docker compose up -d --build
```

The container rebuilds with the new content and goes live within a minute or two. The old container keeps serving until the new one is ready.

> **Tip — make it a one-liner:** add this to your shell aliases:
> ```bash
> alias kb-deploy='ssh user@your-vps "cd knowledge-base && git pull && docker compose up -d --build"'
> ```
> Then `kb-deploy` from your laptop triggers a full update.

---

## Local preview (no VPS needed)

To preview the site locally before pushing:

```bash
docker build --build-arg BASE_URL=localhost -t public-knowledge-kb:test .
docker run --rm -p 8080:8080 public-knowledge-kb:test
```

Open [http://localhost:8080](http://localhost:8080). Wikilinks, backlinks, graph view, and search all work the same as on the live site.

---

## Repo structure

```
app-obsidian-quartz/
├── md-notebook/        # your Obsidian vault — edit this
│   └── index.md        # homepage
├── quartz/             # Quartz v4.4.1 source (vendored, do not edit)
├── auth-service/       # login gate: password + security questions (server.js)
├── Dockerfile          # builds the static site, then serves it with nginx
├── docker-compose.yml  # two services (kb, kb-auth); plugs into Traefik via Docker labels
├── nginx.conf          # minimal static file server config (port 8080)
├── .env.example        # copy to .env and fill in DOMAIN, BASE_URL, and auth settings
└── DEPLOY.md           # full VPS deployment runbook
```

---

## Access control

The entire site requires logging in — password + security questions, checked by
`kb-auth-service` before Traefik proxies anything through. See the
[Access control](./DEPLOY.md#access-control--password--security-questions-with-shareable-links)
section in `DEPLOY.md` for setup and the quarterly rotation routine.

## Traefik stack changes for this feature

**None expected.** The existing Traefik stack lives on the VPS and isn't part of
this repo, but every routing/auth feature so far — TLS, security headers, rate
limiting, and now this login gate — was wired up entirely through Docker labels on
this repo's own containers (`docker-compose.yml`). Traefik's Docker provider picks
up labels from any container on the shared `proxy` network, and `forwardAuth` (what
gates the site now) is a core Traefik middleware, not a plugin — so the same holds
here: you shouldn't need to touch the separate Traefik stack's own config at all.

If it doesn't work out of the box after `git pull && docker compose up -d --build`,
check on the VPS (against the *actual* Traefik container, not this repo):

```bash
docker logs <traefik-container> | grep -i kb-auth   # confirms the new router/middleware were picked up
docker inspect <traefik-container> --format '{{.Config.Cmd}}'   # confirm --providers.docker is present
```

If the Docker label provider turns out not to be enabled there (unlikely, since the
existing `kb` labels already work today), that would be the one scenario needing a
manual edit to the Traefik stack's own compose/static config — see
[Traefik's Docker provider docs](https://doc.traefik.io/traefik/providers/docker/)
for what to add.
