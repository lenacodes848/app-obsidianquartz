This is a read-only public deployment behind the VPS's existing Traefik. It publishes no host ports and manages no certificates.

---

## Prerequisites

- Hostinger VPS (Debian/Ubuntu) with SSH access as a sudo-capable user.
- **The existing Traefik stack is already running**, and its Docker network named **`proxy`** exists. Verify with: `docker network ls | grep proxy`.
- A **DNS A record** for your subdomain (e.g. `kb.example.com`) pointing at the VPS public IPv4 (add AAAA too if the VPS has IPv6). Traefik's HTTP-01 challenge needs this resolving first.

---

## Step 1 — (If Docker isn't already installed) install Docker

> Traefik is already running, so Docker is almost certainly installed. Skip if `docker` works.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER   # log out/in after this
```

> On Debian, replace `ubuntu` with `debian` in the two URLs above.

---

## Step 2 — Firewall

> Traefik already owns 80/443. Only ensure SSH + those two are allowed; do NOT open anything for this app (it publishes no host ports).

```bash
# If ufw is already configured for the Traefik stack, you likely need to change NOTHING.
sudo ufw status
# If ufw is not yet set up:
# sudo apt-get install -y ufw
# sudo ufw default deny incoming && sudo ufw default allow outgoing
# sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
# sudo ufw enable
```

---

## Step 3 — Confirm the proxy network exists

```bash
docker network ls | grep proxy   # must show a network named exactly "proxy"
```

If it's missing, the Traefik stack isn't up — start it first.

---

## Step 4 — Clone and configure

```bash
git clone https://github.com/linnali577/app-obsidian-quartz.git knowledge-base
cd knowledge-base
cp .env.example .env
nano .env          # set DOMAIN and BASE_URL to your real subdomain, e.g. kb.example.com
```

You also need to set `KB_AUTH_HTPASSWD`, `KB_SECURITY_QUESTIONS`, and
`KB_SESSION_SECRET` in `.env` before launching — see
[Access control](#access-control--password--security-questions-with-shareable-links)
below. The entire site is gated by them, and `docker compose up` will refuse to
start (hard error, not just a warning) if any is unset.

---

## Step 5 — Launch

```bash
docker compose up -d --build
docker compose logs -f kb            # confirm nginx started
docker logs -f traefik 2>&1 | grep -i acme   # (optional) watch cert issuance on the proxy
```

Visit `https://<your-domain>` — it should load over valid HTTPS issued by Traefik.

---

## Step 6 — Updating content later

Edit notes in Obsidian locally, commit, push. Then on the VPS:

```bash
cd knowledge-base
git pull
docker compose up -d --build         # rebuilds the static site with new notes
```

> Optional automation (cron/webhook) is out of scope for v1.

---

## Access control — password + security questions, with shareable links

The entire site sits behind a login page (password **and** a set of security
questions — all must be answered correctly in one submission) served by a small
`kb-auth-service` container (`auth-service/`). Traefik checks every request against
it via a `forwardAuth` middleware before the request ever reaches the static site —
nothing in the site itself needs to know about it. There's no public/unauthenticated
tier: every page, including the ones below, requires logging in once opened. Once
logged in, a session cookie is good for 90 days — no re-authentication on other
pages until it expires (or is rotated out, see below).

**Shareable links (`unlisted: true`).** Add `unlisted: true` to a note's frontmatter
to keep it out of the site's nav sidebar, on-site search, the graph view,
`sitemap.xml`, the RSS feed, folder listings, tag listings, and the Backlinks panel
of any page it links to or from (a `noindex` tag is added too, for what it's worth
behind a login wall). The page still builds normally at its usual URL — send that
URL to whoever you want to share it with; if they don't already have a valid
session they'll be redirected to log in the same as anywhere else on the site.

```markdown
---
title: Grandma's 80th Birthday
unlisted: true
---
```

This keeps a page out of casual browsing/search even for people who already have a
session, while still requiring login for anyone following the link cold.

### One-time setup

**1. Password** (unchanged from before):

```bash
# No local install needed — runs htpasswd from a throwaway container.
# -C 12 sets the bcrypt cost factor explicitly (htpasswd's default is 5,
# which is too cheap to crack offline if the hash ever leaks — cost is
# exponential, so 12 is ~128x more work per guess than the default, at
# negligible login latency for a handful of users).
docker run --rm httpd:2.4-alpine htpasswd -nbBC 12 familyuser 'YOUR_PASSWORD'
```

Copy the full `familyuser:$2y$12$....` output into `.env` as `KB_AUTH_HTPASSWD`
(paste the hash as-is — no need to escape the `$` signs; that's only required when a
hash is written directly into `docker-compose.yml` labels, not when it comes from
`.env`). The auth service verifies this the same way Traefik's basic auth used to —
`$2y$` (Apache's htpasswd format) hashes verify correctly against it.

**2. Security questions** — edit `KB_SECURITY_QUESTIONS` in `.env` directly, as
plain text (this file is already gitignored and lives only on the VPS — same trust
boundary as the password hash above):

```bash
KB_SECURITY_QUESTIONS=[{"q":"What is Linna's favorite fruit?","a":"mango"},{"q":"How old is our cat?","a":"7"}]
```

Add as many question/answer pairs as you like. All of them must be answered
correctly (case-insensitive, extra whitespace ignored) alongside the password to
log in.

**3. Session secret** — generate once:

```bash
openssl rand -hex 32
```

Paste the output into `.env` as `KB_SESSION_SECRET`. This signs session cookies;
anyone who already has a valid cookie stays logged in across restarts as long as
this value doesn't change.

Then apply it all:

```bash
docker compose up -d --build
```

### Verify it's working

```bash
# No session — should redirect (302) to /_kb-auth/login
curl -I https://<your-domain>/
```

Then in an actual browser: visit `https://<your-domain>/`, confirm you're
redirected to the login page, submit the wrong password/answers (confirm a generic
error, not a hint about which field was wrong), then submit the correct password
and all correct answers — you should land back on the page you started from, and
navigating elsewhere on the site shouldn't prompt again.

To confirm logout works: visit `https://<your-domain>/_kb-auth/logout` — this
shows a confirmation page rather than logging you out immediately (a bare link or
`<img>` tag can't trigger a logout by itself). Click the "Log out" button to
actually clear the session; you should be redirected to `/` and prompted to log in
again on your next page load.

### Changing or rotating credentials (do this every ~3 months)

1. Regenerate the password hash with the `htpasswd` command above (if you're
   rotating the password too), and/or edit `KB_SECURITY_QUESTIONS` with new
   questions/answers.
2. **Also regenerate `KB_SESSION_SECRET`** (`openssl rand -hex 32`) at the same
   time — this instantly invalidates every existing session cookie, so everyone
   has to log in again with the new questions/answers. Skipping this step means
   old sessions keep working under the old questions until they naturally expire
   at 90 days.
3. `docker compose up -d` to apply — env vars are read at container start, not
   baked into the image, so no `--build`/rebuild is needed for a rotation, same as
   before.

---

## Troubleshooting

- **404 from Traefik ("no route"):** router rule/host mismatch, or container not on the `proxy` network, or `traefik.enable=true` missing.
- **502 Bad Gateway:** `loadbalancer.server.port` doesn't match the real listen port (8080 for the `kb` site, 8081 for `kb-auth-service`).
- **Cert not issued:** DNS A record not resolving to the VPS yet, or the subdomain wasn't reachable on port 80 for the HTTP-01 challenge.
- **`kb-auth-service` won't start / exits immediately:** check `docker compose logs kb-auth` — it hard-fails on boot if `KB_SECURITY_QUESTIONS` isn't valid JSON, or if any of the three required env vars is unset. The error message names which one.
- **Redirect loop on the login page:** the `kb-auth-pages` router's `priority` must stay higher than the main `kb` router's, and its `middlewares` label must **not** include `kb-forwardauth` — otherwise reaching the login page itself requires being already logged in.
- **403 Forbidden on `/_kb-auth/login` or `/_kb-auth/logout`:** these two endpoints check the request's `Origin`/`Referer` header against its own `Host` before accepting the submission (CSRF protection) — a 403 means one of those headers was present but didn't match, which is expected for a genuine cross-site attempt. It should **not** happen for a normal browser submitting the actual form: the check only fails closed on a *mismatch*, not on the headers being absent, so an ordinary login/logout POST always gets through. If you see this unexpectedly, look for something rewriting `Host`/`Origin`/`Referer` between the browser and Traefik — e.g. a CDN or another reverse proxy sitting in front of this stack — rather than the browser itself.

---

## Optional Hardening (not enabled by default)

### Restrict to a specific IP range

Add a Traefik IP-allowlist middleware on top of the existing ones (order matters —
this runs the IP check before the forward-auth call). Add it to **both** routers if
you use it — the main site and the login page itself — otherwise someone outside
the allowed range could still reach `/_kb-auth/login` and attempt to log in:

```yaml
      - "traefik.http.middlewares.kb-ip.ipallowlist.sourcerange=203.0.113.0/24,198.51.100.7/32"
      - "traefik.http.routers.kb.middlewares=kb-ip,kb-sec,kb-forwardauth"
      - "traefik.http.routers.kb-auth-pages.middlewares=kb-ip,kb-sec,kb-ratelimit-login"
```
