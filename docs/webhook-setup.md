# Webhook setup runbook

Wire a Contentstack outgoing webhook to the app's `/api/webhook` endpoint so that
publishing content automatically triggers the transcreation pipeline.

There is nothing to do until the app is deployed and reachable at a public URL —
Contentstack needs a URL to POST to. This runbook covers both halves:

1. [Deploy the app to Vercel](#1-deploy-the-app-to-vercel) and get the endpoint URL.
2. [Create the webhook](#2-create-the-webhook) (scripted **or** manual).
3. [Test it](#3-test-it).

## How verification works (read this first)

`app/api/webhook/route.ts` protects the endpoint with a shared secret sent as a
**custom HTTP header**:

- Header name: **`x-contentstack-webhook-secret`**
  (route.ts also accepts `cs-webhook-secret` as a fallback; prefer the first.)
- Expected value: the env var **`CONTENTSTACK_WEBHOOK_SECRET`** on the *deployed app*.

So the webhook must send header `x-contentstack-webhook-secret: <secret>` where
`<secret>` equals `CONTENTSTACK_WEBHOOK_SECRET` set in the app's environment. The
`npm run sync:webhook` script does this for you; if you configure the webhook by
hand, add that exact header/value.

> If `CONTENTSTACK_WEBHOOK_SECRET` is **unset** on the app, route.ts logs a warning
> and skips verification (open endpoint). Always set it in production.

## 1. Deploy the app to Vercel

Any host works; Vercel is assumed here.

1. Push the repo to GitHub and import it in Vercel, **or** deploy from the CLI:

   ```bash
   npm i -g vercel        # once
   vercel                 # link + preview deploy
   vercel deploy --prod   # production deploy
   ```

2. Set the project's environment variables (Vercel → Project → Settings →
   Environment Variables), matching `.env.example`:

   | Variable | Required | Notes |
   | --- | --- | --- |
   | `CONTENTSTACK_API_KEY` | yes | Stack API key. |
   | `CONTENTSTACK_MANAGEMENT_TOKEN` | yes | Read/write on content types + entries. |
   | `CONTENTSTACK_ENVIRONMENT` | yes | Delivery environment, e.g. `production`. |
   | `CONTENTSTACK_REGION` | if non-NA | `na`\|`eu`\|`au`\|`azure-na`\|`azure-eu`\|`gcp-na`\|`gcp-eu`. |
   | `CONTENTSTACK_WEBHOOK_SECRET` | yes | Long random string; the webhook must send the same value. |
   | `REASONING_PROVIDER` | yes | `aisdk` (default) or `eve`. |
   | `AI_GATEWAY_API_KEY` | see notes | Needed for `aisdk` unless you rely on Vercel **OIDC** (`VERCEL_OIDC_TOKEN`), which is automatic on Vercel — then it can be omitted. |
   | `AI_MODEL` | optional | e.g. `openai/gpt-4o`. |
   | `EVE_AGENT_URL`, `EVE_TRIGGER_SECRET` | if `REASONING_PROVIDER=eve` | eve channel URL + secret. |
   | `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` | for Slack push | The one real external push. |

3. Grab the production URL (e.g. `https://your-app.vercel.app`). **Your endpoint is:**

   ```text
   https://your-app.vercel.app/api/webhook
   ```

## 2. Create the webhook

Pick **one** of the two paths below. Both are idempotent in effect (the script
updates an existing webhook by name; manual edits update the same one in the UI).

### Path A — scripted (recommended)

Requires `CONTENTSTACK_API_KEY`, `CONTENTSTACK_MANAGEMENT_TOKEN`, and
`CONTENTSTACK_WEBHOOK_SECRET` in your local `.env.local`/`.env` (see `.env.example`),
plus the target URL from step 1:

```bash
# Preview the exact body first (no writes, secret redacted):
WEBHOOK_TARGET_URL=https://your-app.vercel.app/api/webhook npm run sync:webhook -- --dry-run

# Create or update the webhook:
WEBHOOK_TARGET_URL=https://your-app.vercel.app/api/webhook npm run sync:webhook
```

The script (`scripts/sync-webhook.ts`) creates-or-updates a webhook named
`one-post-pipeline` that:

- POSTs to `WEBHOOK_TARGET_URL`,
- sends header `x-contentstack-webhook-secret` = `CONTENTSTACK_WEBHOOK_SECRET`,
- triggers on channel `content_types.blog_post.entries.publish.success`.

Overrides (optional env): `WEBHOOK_NAME`, `WEBHOOK_TRIGGER`, `CONTENTSTACK_REGION`.

### Path B — manual (Contentstack UI)

Contentstack → **Settings → Webhooks → + New Webhook**:

1. **Name**: `one-post-pipeline`.
2. **URL to notify**: `https://your-app.vercel.app/api/webhook`.
3. **Custom header**: add one row →
   - Key: `x-contentstack-webhook-secret`
   - Value: the same string as the app's `CONTENTSTACK_WEBHOOK_SECRET`.
4. **Trigger / When**: *Entry* → *Publish* → *Success*, scoped to the **Blog Post**
   (`blog_post`) content type. (This corresponds to the channel
   `content_types.blog_post.entries.publish.success`.)
5. Leave retry policy as-is and ensure the "concise payload" option is **off** so
   route.ts receives the full entry payload.
6. Save.

## Trigger reference

Default trigger channel:

```text
content_types.blog_post.entries.publish.success
```

- Format source: Contentstack **Webhook Events** reference
  (<https://www.contentstack.com/docs/headless-cms/webhook-events>) — the
  specific-content-type prefix `content_types.{contenttype_uid}.entries.` combined
  with the `publish.success` event (see also **Webhook Data Format**, where
  `publish.success` is an enumerated event, and the **CMA → Webhooks** examples that
  use `channels: ["content_types.entries.create"]`).

### Switching to a workflow-stage trigger later

The current stack has **no workflow**, so we trigger on `blog_post` publish for now.
Note that `route.ts` also understands a workflow payload: it only proceeds when the
workflow stage is **"Ready for Distribution"** (other stages are skipped), and
otherwise processes the entry as-is. Once you create a workflow with a
"Ready for Distribution" stage:

1. Create the workflow in Contentstack and note its `workflow_uid` (and the target
   `workflow_stages_uid` if you want to scope to a single stage).
2. Change the trigger to a workflow channel, e.g.:

   ```bash
   # Any stage change of a specific workflow, for blog_post entries:
   WEBHOOK_TRIGGER=content_types.blog_post.entries.workflows.<workflow_uid> \
   WEBHOOK_TARGET_URL=https://your-app.vercel.app/api/webhook \
   npm run sync:webhook

   # Or a specific stage transition:
   WEBHOOK_TRIGGER=content_types.blog_post.entries.workflows.<workflow_uid>.<workflow_stages_uid> \
   WEBHOOK_TARGET_URL=https://your-app.vercel.app/api/webhook \
   npm run sync:webhook
   ```

   (Workflow channel formats are from the same Webhook Events reference, "Entry
   Workflows" section.) In the UI, choose the *Workflow* trigger instead of *Publish*.

## 3. Test it

1. Ensure the stack is bootstrapped: `npm run sync:models`, `npm run sync:locales`,
   and `npm run seed:blog` (seeds the sample Blog Post).
2. **Publish** the seeded Blog Post entry to the configured environment.
3. On publish success, Contentstack POSTs to `/api/webhook`, which verifies the
   secret header, reads the entry, and runs the pipeline (transcreate → fact-check →
   write Channel Variants → move the Blog Post to "Needs Review").
4. Confirm it ran:
   - Vercel → your project → **Logs**: look for `[webhook]` entries and pipeline output.
   - Contentstack → **Settings → Webhooks → one-post-pipeline → Executions**: the
     delivery should show a 2xx response.
   - New **Channel Variant** entries (en + es/fr) should appear in the stack.

> **Latency caveat:** the pipeline fans out across channels × locales and calls
> external model providers, which are rate-limited. A full run can take a while and
> may back off/retry; the route allows up to `maxDuration = 300s`. The webhook is
> acknowledged (2xx) even while heavy work continues, so judge success from the
> logs and the created Channel Variant entries, not from instant completion.

## Troubleshooting

- **401 `invalid webhook secret`**: the header value doesn't match the app's
  `CONTENTSTACK_WEBHOOK_SECRET`. Re-run `npm run sync:webhook` after aligning both,
  or fix the custom header in the UI.
- **Endpoint acknowledges but does nothing** (`processed: false`, stub mode): the
  app is missing `CONTENTSTACK_API_KEY` / `CONTENTSTACK_MANAGEMENT_TOKEN`. Set them
  in Vercel and redeploy.
- **Webhook not firing**: confirm you published to the environment the webhook is
  scoped to, and that the trigger channel matches your content type uid.
