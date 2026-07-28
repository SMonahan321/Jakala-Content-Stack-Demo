# Contentstack content models

Two content types back this project. The JSON files here follow the Contentstack
Management API content-type shape and can be created in three ways.

## Files

- `blog-post.json` — the `blog_post` source content type (system of record).
- `channel-variant.json` — the `channel_variant` generated-output content type,
  referenced back to a `blog_post`.

## Fields at a glance

**Blog Post (`blog_post`)**: `title`, `summary`, `body`, `key_claims[]`.

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

## How to create the content types

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
