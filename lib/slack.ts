/**
 * Slack — the ONE real external push in this project.
 *
 * After a human approves the reviewed variants, we post an approval summary /
 * "ready to publish" digest to a Slack channel via the Web API (bot token).
 */

import { WebClient } from "@slack/web-api";

import type { Channel, ChannelVariant, Locale } from "./types";

export function isSlackConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID);
}

function getClient(): WebClient {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set.");
  return new WebClient(token);
}

const CHANNEL_LABEL: Record<Channel, string> = {
  linkedin: "LinkedIn",
  x: "X / Twitter",
  instagram: "Instagram",
};

const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
};

/**
 * Post a short digest of approved variants to Slack.
 * Returns the message timestamp (ts) on success.
 */
export async function postApprovedVariants(
  blogTitle: string,
  variants: ChannelVariant[],
): Promise<{ ok: boolean; ts?: string }> {
  const channelId = process.env.SLACK_CHANNEL_ID;
  if (!channelId) throw new Error("SLACK_CHANNEL_ID is not set.");

  const client = getClient();
  const blocks = buildBlocks(blogTitle, variants);

  const result = await client.chat.postMessage({
    channel: channelId,
    text: `Approved & ready to distribute: "${blogTitle}" (${variants.length} variants)`,
    blocks,
  });

  return { ok: Boolean(result.ok), ts: result.ts };
}

function buildBlocks(blogTitle: string, variants: ChannelVariant[]) {
  const header = {
    type: "header",
    text: { type: "plain_text", text: `✅ Approved: ${blogTitle}` },
  };

  const context = {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `${variants.length} channel × locale variants passed review and are ready to distribute.`,
      },
    ],
  };

  const variantBlocks = variants.map((v) => ({
    type: "section",
    text: {
      type: "mrkdwn",
      text:
        `*${CHANNEL_LABEL[v.channel]} · ${LOCALE_LABEL[v.locale]}* (${v.charCount} chars)\n` +
        `${truncate(v.formattedText, 400)}\n` +
        (v.hashtags.length ? `_${v.hashtags.map((h) => `#${h}`).join(" ")}_` : ""),
    },
  }));

  return [header, context, { type: "divider" }, ...variantBlocks];
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
