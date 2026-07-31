# Contentstack content models

Two content types back this project. The JSON files here follow the Contentstack
Management API content-type shape and can be created in three ways.

## Files

- `blog-post.json` — the `blog_post` source content type (system of record).
- `channel-variant.json` — the `channel_variant` generated-output content type,
  referenced back to a `blog_post`.

## Fields at a glance

**Blog Post (`blog_post`)**: `title`, `summary`, `body`, `key_claims[]`,
`featured_image` (file / single asset).

- `featured_image` — `data_type: "file"`, `multiple: false` (a single Contentstack
  asset). Optional (`mandatory: false`). It's the hero image for the post and the
  source asset the channel image-crop specs describe. Everything downstream treats
  it as optional, so entries without it keep working.

**Channel Variant (`channel_variant`)**: `title`, `channel` (enum: `linkedin|x|instagram`),
`formatted_text`, `hashtags[]`, `char_count`, `image_crop_spec` (JSON string),
`status` (enum: `generated|needs_review|flagged|approved|published`),
`source_blog` (reference → `blog_post`).

## Locales

Add these locales in **Settings → Languages** (English is the master):

- `en` — English (master / source)
- `es` — Spanish (target)
- `fr` — French (target)

Channel Variant entries are created in `en`, then localized into `es` and `fr`.

## Workflow

Create one workflow (Settings → Workflows) on **Blog Post** with stages:

`Draft → Ready for Distribution → Needs Review → Approved → Published`

- **Ready for Distribution** is the trigger: a webhook fires on transition into it.
- **Needs Review** is the human gate the agent moves entries into after write-back.
- Copy each stage's `uid` into the webhook route / env where noted (`TODO`s in
  `lib/contentstack.ts` and `app/api/webhook/route.ts`).

## Sync the models programmatically

The recommended way to create or update the content types is the sync script — this
is how you "update the Contentstack model programmatically" (e.g. so a new field like
`featured_image` propagates to your stack).

```bash
npm run sync:models            # create/update — WRITES to your stack
npm run sync:models -- --dry-run   # read-only preview (or: npm run sync:models:dry)
```

**Env is loaded automatically.** The script loads environment variables from
`.env.local` then `.env` at the repo root, with **Next.js-style precedence
(`.env.local` overrides `.env`)** — `tsx` does not auto-load these the way Next.js
does, so the script does it via `dotenv`. Just put your creds in `.env` (or
`.env.local`) and run; no `export …` dance required.

**What it does.** Reads every definition in `content-models/*.json` and, for each
content type, checks whether it already exists in your stack, then:

- **creates** it from the JSON if it doesn't exist, or
- **updates** it (fetch → apply the JSON schema → update) if it does.

It's **idempotent** — safe to run repeatedly. `blog_post` is synced **before**
`channel_variant` so the `channel_variant.source_blog` reference to `blog_post`
resolves on first create.

**Preview first with `--dry-run`.** Pass `--dry-run` (or `--check`) to authenticate
and do only the **read-only** content-type listing, then print whether each of
`blog_post` / `channel_variant` **would be created** (absent) or **updated**
(exists) — and exit **without writing anything**. It prints a
`[sync] DRY RUN — no changes written` banner so it's unmistakable.

| Command | Writes? | Use for |
| --- | --- | --- |
| `npm run sync:models` | **yes** (create/update) | Actually provision/update the stack. |
| `npm run sync:models -- --dry-run` | no (read-only) | Preview the plan / smoke-test creds + region. |
| `npm run sync:models:dry` | no (read-only) | Convenience alias for the dry run. |

**Env it needs** (see [`.env.example`](../.env.example); put these in `.env` or
`.env.local` — they load automatically):

| Var | Required | Notes |
| --- | --- | --- |
| `CONTENTSTACK_API_KEY` | yes | Stack API key. |
| `CONTENTSTACK_MANAGEMENT_TOKEN` | yes | Management token (read/write content types). |
| `CONTENTSTACK_REGION` | no | `na` (default) `\| eu \| au \| azure-na \| azure-eu \| gcp-na \| gcp-eu`. Passed to the SDK's `region` option so non-NA stacks hit the right API host. |

The script fails fast with a clear message if a required var is missing or the region
value is unrecognized.

**How updates behave.** Adding fields is **non-destructive** — existing fields and
data are preserved; the new field just appears. Each update bumps the content type's
**version** in Contentstack (content types are versioned), so you can review/roll back
in the UI. Renaming or removing a field's `uid`, however, is a schema change that can
affect existing entries — treat those deliberately.

**The plan.** Set your keys in `.env.local` (or `.env`), run
`npm run sync:models -- --dry-run` to confirm the plan + that creds/region work,
then `npm run sync:models` once to bootstrap the stack — and re-run it any time
the JSON in this folder changes.

## How to create the content types

Besides the sync script above, the same JSON can be applied manually:

### Option A — Contentstack UI (fastest for the demo)
Recreate the fields above under **Content Models → + New Content Type**. Match the
`uid`s exactly (`blog_post`, `channel_variant`) so the code paths line up.

### Option B — Management API (curl)
```bash
curl -X POST "https://api.contentstack.io/v3/content_types" \
  -H "api_key: $CONTENTSTACK_API_KEY" \
  -H "authorization: $CONTENTSTACK_MANAGEMENT_TOKEN" \
  -H "Content-Type: application/json" \
  --data @blog-post.json

curl -X POST "https://api.contentstack.io/v3/content_types" \
  -H "api_key: $CONTENTSTACK_API_KEY" \
  -H "authorization: $CONTENTSTACK_MANAGEMENT_TOKEN" \
  -H "Content-Type: application/json" \
  --data @channel-variant.json
```
> Create `blog_post` first — `channel_variant` references it.
> Use the API host for your region (e.g. `eu-api.contentstack.com` for EU).

### Option C — Management SDK
The same JSON can be passed to `stack.contentType().create(<json>)` using
`@contentstack/management` (see `lib/contentstack.ts` for the client setup).
