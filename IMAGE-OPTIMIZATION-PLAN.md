# Image optimization plan

Plan of record for #27 (compression), #29 (lazy-loading), and #28 (Git LFS), in that
priority order. #30 (object storage + CDN) is explicitly out of scope here — only
worth revisiting if image volume outgrows what these three handle.

All three source issues carry a "do not work on this until explicitly prompted"
gate. This doc is the plan for review before any of the implementation steps below
are actually carried out; each still needs its own go-ahead.

## Current state (as of this plan)

- `md-notebook/` has 0 images today, 352K total — this is forward-looking work,
  not a fix for a current problem.
- No compression step exists anywhere in the pipeline; `Assets` emitter
  (`quartz/quartz/plugins/emitters/assets.ts`) does a straight `fs.copyFile` for
  every non-markdown file.
- `sharp` is already a build dependency and already used the same way in
  `quartz/quartz/plugins/emitters/ogImage.tsx:42` (`sharp(buf).webp({ quality: 40 })`).
- `loading="lazy"` support already exists in the vendored `CrawlLinks` transformer
  (`quartz/quartz/plugins/transformers/links.ts:144`) behind an `opts.lazyLoad` flag
  that defaults to `false` and is not enabled in this repo's `quartz.config.ts`.
- Deployment (`DEPLOY.md`) clones/pulls directly on the VPS
  (`git clone` → `git pull` → `docker compose up -d --build`), no CI/build server
  in between.

## Priority 1 — #27: compress/resize images before they enter the vault

Decision already recorded on #27: build-time compression via `sharp` in the
`Assets` emitter, mirroring the existing `ogImage.tsx` pattern. Resize to a max
width of ~1600–2000px, re-encode to WebP. Originals stay untouched in git —
decoupled from #28 (repo growth) on purpose.

**Correction to the original decision comment**: it scoped this as an
`assets.ts`-only change. That's not sufficient. The `<img src>` HTML is generated
earlier, in `quartz/quartz/plugins/transformers/ofm.ts:230`, when a wikilink embed
(`![[photo.png]]`) is parsed — it bakes the *original* extension into the `url`
via `slugifyFilePath(fp)`. If `assets.ts` alone starts emitting `photo.webp` to
disk, the HTML will still request `photo.png` and 404. Both files must change in
lockstep, rewriting the extension to `.webp` for the same set of formats on both
sides.

**Steps:**
1. `assets.ts`: for `.png`/`.jpg`/`.jpeg`, pipe through
   `sharp(src).resize({ width: 1800, withoutEnlargement: true }).webp({ quality: ~80 })`
   and write to `dest` with `.webp` swapped in. All other extensions keep the
   existing `copyFile` path unchanged.
2. `ofm.ts:229-231`: when the matched extension is one of the compressible set,
   rewrite the extension on `url` to `.webp` before returning the image node —
   matching whatever set was chosen in step 1.
3. Deliberately leave `.gif` untouched (animation would be destroyed by a
   single-frame WebP re-encode; animated WebP output is more engineering for
   uncertain payoff on a notes vault — skip for v1).
4. Add `quartz/quartz/plugins/emitters/assets.ts` and
   `quartz/quartz/plugins/transformers/ofm.ts` to the "6 files carrying local
   customizations" list in `DEPLOY.md`'s vendored-Quartz-update section, so a
   future `git subtree pull` doesn't silently overwrite them.
5. Test: drop an oversized real image into `md-notebook/`, run a build, confirm
   output format/size and that the page renders it correctly.

## Priority 2 — #29: lazy-loading

**Pros:** defers offscreen image fetches until scroll proximity — meaningfully
cuts initial page weight on long image-heavy notes; native browser feature, no JS
shipped; complements #27 (smaller images + fewer requests-per-pageview).

**Cons:** possible pop-in/layout shift if dimensions aren't reserved (minor risk
here — the wikilink embed syntax already sets explicit `width`/`height` via
`ofm.ts:234-235`); no measurable win on short notes with only 1-2 images near the
top.

**Mechanics:** standard `loading="lazy"` HTML attribute — browser-native
scheduling based on scroll proximity, no `IntersectionObserver` polyfill needed in
any evergreen browser.

**Finding:** this is already built. `links.ts:144` has
`if (opts.lazyLoad) { node.properties.loading = "lazy" }`, a supported option on
upstream `CrawlLinks` (`defaultOptions.lazyLoad = false`). This repo's
`quartz.config.ts:72` calls `Plugin.CrawlLinks({ markdownLinkResolution: "shortest" })`
without `lazyLoad: true`. No vendored transformer edit needed, and no new file to
add to the customization list — `quartz.config.ts` is already tracked as
customization #1 in `DEPLOY.md`.

**Step:**
1. `quartz/quartz.config.ts:72` →
   `Plugin.CrawlLinks({ markdownLinkResolution: "shortest", lazyLoad: true })`.

## Priority 3 — #28: Git LFS

**Mechanics:** `.gitattributes` marks image extensions as LFS-tracked
(`filter=lfs diff=lfs merge=lfs -text`). On `git add`, real bytes go to
`.git/lfs/objects` (content-addressed) and a ~130-byte pointer file goes into the
actual git blob/history. On checkout/pull, the LFS smudge filter swaps pointers
back for real bytes via the Git LFS Batch API (HTTPS, separate from the git wire
protocol) — this is what keeps `.git` history flat regardless of image churn.

**GitHub vs GitLab vs Gitea:** all three implement the same open Git LFS Batch API
spec, so the client-side workflow (`git lfs install`, `.gitattributes`,
`git lfs track`, `git lfs pull`) is identical regardless of host.
- **GitHub** (current host): free tier is 1GB storage + 1GB bandwidth/month per
  LFS data pack; overage needs paid data packs. The one host here with a real
  quota to watch.
- **GitLab**: same protocol; on GitLab.com, LFS objects count against the
  project/namespace storage quota (shared with repo + artifacts + packages).
  Self-hosted GitLab (CE/EE) has no artificial cap — bounded by your own disk or
  an S3-compatible backend, transparent to clients.
- **Gitea**: LFS built in since ~1.x, self-hosted, no artificial quota — local
  disk or S3-compatible backend, admin-configurable.

LFS blobs are host-specific storage, not part of the git pack — they don't
travel automatically on a remote change. A future host migration would need
`git lfs fetch --all` against the old remote, then `git lfs push --all` to the
new one, as its own step. Not relevant today (staying on GitHub) but relevant if
a self-hosted move ever comes up.

**Will Quartz still render images correctly regardless of LFS backend?** Yes,
unconditionally. Quartz's build never speaks git or HTTP to fetch images — it
does `fs.readFile`/`glob` over whatever's already in the checked-out working
tree. By the time `docker compose up -d --build` runs, LFS's smudge filter has
already turned pointers into real files on disk (assuming `git lfs pull`
happened as part of `git pull`) — Quartz can't distinguish an LFS-backed file
from a regular one. The one real failure mode: if `git-lfs` isn't installed on
the VPS, or the deploy step skips the smudge filter (shallow clone, `git
archive`, a Docker `COPY` from a context that never ran `git lfs pull`), image
paths resolve to ~130-byte pointer text files instead of real bytes — `sharp`
would error on them or silently emit a broken image. This matches what #28's own
body already flags under "Requires."

**Steps (when gated open):**
1. `git lfs install` + `.gitattributes` tracking image extensions under
   `md-notebook/` on the authoring machine.
2. Re-add existing images through LFS (rewrites history for those files — needs
   care since this repo is already pushed).
3. Install `git-lfs` on the VPS so `git pull` fetches real blobs, not pointers.
4. Confirm the Docker build context picks up real files (not LFS pointer stubs)
   during `docker compose up -d --build`.

## Sequencing

1. **#27** first — two-file (`assets.ts` + `ofm.ts`) change, per the corrected
   plan above.
2. **#29** next — one-line config flip, cheap enough to batch into the same PR
   as #27 or a fast follow.
3. **#28** last — bigger blast radius (rewrites git history for existing images,
   needs `git-lfs` provisioned on the VPS, needs the Docker build context
   verified) — its own PR, with a rollback plan, not bundled with #27/#29.
