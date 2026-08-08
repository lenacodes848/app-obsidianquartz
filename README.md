# Public Knowledge Base

A personal knowledge graph published to the web. Notes are written in [Obsidian](https://obsidian.md/), version-controlled in this repo, and rendered as a static website using [Quartz v4](https://quartz.jzhao.xyz/). The site is served from a VPS behind Traefik and updates with a single `git push`.

All content covers topics found on the public internet — articles, concepts, and connections the owner finds worth keeping.

---

## Two ways to deploy

This repo supports two independent deployment modes against the same `md-notebook/` vault, each with its own password:

- **Public** — a VPS behind Traefik, TLS via Let's Encrypt, gated by password + security questions. See [Deploying to the VPS](#deploying-to-the-vps).
- **Local** — a single container on a private server (home network / Tailscale), no reverse proxy or TLS, gated by password only. See [Deploying locally](#deploying-locally-lantailscale).

Pick one, or run both side by side (they use separate `docker-compose*.yml` files, containers, and ports).

---

## How it works (public deployment)

```
Write in Obsidian  →  git push  →  VPS pulls & rebuilds Docker image  →  Live site
```

- **`md-notebook/`** — the Obsidian vault. All your notes live here as plain markdown files.
- **Quartz** turns those notes into a static site with wikilinks, backlinks, graph view, and search.
- **nginx** (inside a Docker container) serves the built HTML.
- **Traefik** (already running on the VPS) handles HTTPS and routes traffic to the container.
- **`kb-auth-service`** (another small container, `auth-service/`) gates every request behind a login page — password + security questions — before Traefik lets it through.

For the local deployment mode, there's no Traefik/nginx split — see [How it works (local deployment)](#how-it-works-local-deployment) below.

---

## Deploying to the VPS

See [`DEPLOY.md`](./DEPLOY.md) for the full step-by-step runbook. The short version:

1. Make sure the VPS is running Traefik with a Docker network named `proxy`.
2. Point a DNS A record at the VPS IP for your chosen subdomain.
3. Clone this repo onto the VPS, copy `.env.example` to `.env`, and fill in `DOMAIN` and `BASE_URL`.
4. Run `docker compose up -d --build`.

Traefik picks up the container automatically and issues a Let's Encrypt certificate.

---

## How it works (local deployment)

```
Write in Obsidian  →  git push  →  server pulls & rebuilds Docker image  →  reload
```

- **`local-server/`** — a small Node service that does two jobs in one process: serves the built static site, and gates every request behind a login page (password only) until a valid session cookie is present.
- No reverse proxy (Traefik/nginx/etc.) in front of this — the container binds a host port directly. Tailscale's own tunnel encryption (plus your home network's trust boundary) stands in for TLS. See [DEPLOY.md](./DEPLOY.md) for the reasoning.

---

## Deploying locally (LAN/Tailscale)

See [`DEPLOY.md`](./DEPLOY.md) for the full runbook. Short version:

1. Clone this repo onto the server.
2. Copy `.env.example` to `.env` and fill in `PORT`, `NOTES_AUTH_HTPASSWD`, and `NOTES_SESSION_SECRET`.
3. Run `docker compose -f docker-compose.local.yml up -d --build`.
4. Visit `http://<server-lan-ip>:<PORT>` (home network) or `http://<server-tailscale-ip>:<PORT>` (Tailscale).

---

## Adding content

### 1. Write in Obsidian

Open the `md-notebook/` folder as your Obsidian vault. Write notes normally — use `[[wikilinks]]` to connect ideas, add tags, and let the graph build itself over time.

A few conventions that keep the site tidy:

- Put an `index.md` at the root of `md-notebook/` — it becomes the homepage.
- Any note with `draft: true` in its frontmatter is excluded from the published site.
- Folders inside `md-notebook/` become sections; Quartz generates folder index pages automatically.
- Drop images in as-is — screenshots, phone photos, whatever. The build compresses
  and resizes them automatically (see [IMAGE-OPTIMIZATION-PLAN.md](./IMAGE-OPTIMIZATION-PLAN.md)),
  so there's no need to shrink anything yourself first.

### 2. Commit and push

Image files under `md-notebook/` are tracked via [Git LFS](https://git-lfs.com)
(`.gitattributes`), so `git-lfs` needs to be installed once on whichever machine
you write from — not just the VPS:

```bash
git lfs install     # once per machine, before your first `git add` of an image
```

Skipping this doesn't break anything visibly at commit time — the image just
gets added as a normal (large) git object instead of an LFS pointer, silently
defeating the point of tracking it. Run `git lfs status` before committing if
you're ever unsure; images should show as `(LFS: ...)`, not `(Git: ...)`.

```bash
cd /path/to/app-obsidianquartz
git add md-notebook/
git commit -m "add: <brief description of what you wrote>"
git push
```

That's it for the writing side.

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

If you're running the local deployment instead (or as well), update it the same way on that server, using the local compose file:

```bash
cd app-obsidianquartz
git pull
docker compose -f docker-compose.local.yml up -d --build
```

---

## Local preview — public deployment (no VPS needed)

To preview the public-deployment build locally before pushing (this build has no
auth gate in front of it — that's a separate container in `docker-compose.yml` —
so it's just for checking how the content itself renders):

```bash
docker build --build-arg BASE_URL=localhost -t public-knowledge-kb:test .
docker run --rm -p 8080:8080 public-knowledge-kb:test
```

Open [http://localhost:8080](http://localhost:8080). Wikilinks, backlinks, graph view, and search all work the same as on the live site.

## Local preview — local deployment (no server needed)

The local-deployment build bakes its auth gate directly into the image, so it needs
real (test) credentials to start:

```bash
cp .env.example .env   # fill in NOTES_AUTH_HTPASSWD and NOTES_SESSION_SECRET
docker compose -f docker-compose.local.yml up --build
```

Open `http://localhost:8286` (or whatever `PORT` you set) and log in with the test password.

---

## Repo structure

```
app-obsidianquartz/
├── md-notebook/              # your Obsidian vault — edit this
│   └── index.md              # homepage
├── quartz/                   # Quartz v4.4.1 source (vendored, do not edit)
├── auth-service/             # public-deployment login gate: password + security questions
├── local-server/             # local-deployment login gate + static file server: password only
├── Dockerfile                # public deployment: builds the static site, then serves it with nginx
├── Dockerfile.local          # local deployment: builds the static site, then serves it via local-server
├── docker-compose.yml        # public deployment: two services (kb, kb-auth); plugs into Traefik via Docker labels
├── docker-compose.local.yml  # local deployment: single service, binds directly to a host port
├── nginx.conf                # public deployment: minimal static file server config (port 8080)
├── .env.example               # copy to .env; fill in whichever mode's section(s) you're deploying
└── DEPLOY.md                  # full runbook for both deployment modes
```

---

## Using this as a template for a new vault

Want to publish a *different* Obsidian vault with its own domain/port and its
own login credentials, fully independent of this repo? That's a fresh copy,
not a new folder in this one — each vault gets its own repo, `.env`, and
deployed container(s).

### 1. Copy the repo

```bash
git clone https://github.com/lenacodes848/app-obsidianquartz.git my-new-vault
cd my-new-vault
```

**Keep the git history — don't `rm -rf .git`.** `quartz/` is tracked as a
[`git subtree`](./DEPLOY.md#updating-the-vendored-quartz-engine), and
`git subtree pull --squash` needs that history to know what's already been
merged from upstream. Wiping it breaks that permanently: a later
`git subtree pull` fails outright with
`fatal: can't squash-merge: 'quartz' was never added.` — the only way back is
re-vendoring Quartz from scratch instead of pulling incremental upstream
updates. Keeping history also means this vault's commit log starts as a copy
of this template's, `md-notebook/Cats/` (this repo's LFS test content) and
`md-notebook/Clippings/` (placeholder content) included — both get removed
in the next step regardless.

### 2. Swap in your own vault

```bash
rm -rf md-notebook/Cats          # this repo's Git LFS test seed content — not yours to keep
rm -rf md-notebook/Clippings     # or whatever placeholder content came with the clone
```

Copy your real Obsidian vault's files into `md-notebook/`, or start empty and
write fresh notes there per [Adding content](#adding-content) above. The
`.gitattributes` file (Git LFS tracking for images) is repo-level, not
vault-specific — it carries over automatically and needs no changes.

### 3. Rebrand the site

In `quartz/quartz.config.ts`, change:

```ts
pageTitle: "Public Knowledge",   // -> your new site's name
```

(`baseUrl` doesn't need touching here — it's a build-time placeholder filled
in from `.env`'s `BASE_URL` specifically, not `DOMAIN` — see the next step.)

### 4. Generate fresh secrets — do not reuse this repo's `.env`

Every credential in `.env` is specific to *this* deployment. Reusing them
across two independent vaults means one shared password/session-signing key
protects both — copy `.env.example` to `.env` and generate everything again
from scratch, following [Access control](#access-control) below:

- New `KB_AUTH_HTPASSWD`/`NOTES_AUTH_HTPASSWD` (`htpasswd`, not the same password)
- New `KB_SECURITY_QUESTIONS` (public mode only)
- New `KB_SESSION_SECRET`/`NOTES_SESSION_SECRET` (`openssl rand -hex 32`)
- Your new `DOMAIN`/`BASE_URL` (public mode) or `PORT` (local mode)

### 5. Push to a new remote and deploy

`git clone` already points `origin` at this template's own repo, so repoint
it rather than adding a second `origin` (which fails with
`error: remote origin already exists.`):

```bash
git remote set-url origin <url-to-your-new-empty-repo>
git add -A
git commit -m "Initial import: my-new-vault"
git push -u origin main
```

Works the same regardless of host — GitHub, GitLab, or a self-hosted Gitea
instance all speak the same Git LFS protocol, so nothing above changes based
on where the new repo lives. From here, follow [`DEPLOY.md`](./DEPLOY.md) for
whichever deployment mode(s) you're using, same as any other instance —
there's nothing template-specific left once the new repo exists.

---

## Access control

**Public deployment** — the entire site requires logging in with a password + security
questions, checked by `kb-auth-service` before Traefik proxies anything through. See the
[Access control](./DEPLOY.md#access-control--password--security-questions-with-shareable-links)
section in `DEPLOY.md` for setup and the quarterly rotation routine.

**Local deployment** — the entire site requires logging in with a single shared
password, independent of the public deployment's credentials — see
[DEPLOY.md](./DEPLOY.md#access-control-local-deployment) for setup and rotation.

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
