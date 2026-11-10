import { db, checked, sendingSettings, feed } from "./lib/core.js";
import { verifyImage } from "./lib/media.js";
import {
  canonicalJSON,
  invariant,
  buildPayload,
  splitBatches,
  summarizeResponse,
} from "../../shared/domain.js";

export async function processNextBatch({
  client,
  getFeed = feed,
  checkImage = verifyImage,
  request = fetch,
}) {
  await checked(client.rpc("cleanup_campaigns"));
  // Always reconcile interrupted processing, but never claim/send unless explicitly enabled.
  const settings = sendingSettings();
  if (!settings.enabled || !process.env.POSTX_BEARER_TOKEN)
    return new Response("Sending disabled");
  splitBatches([], settings.batchSize, settings.verifiedLimit);
  const batch = await checked(client.rpc("claim_batch"));
  if (!batch) return new Response("No pending batch");
  let attempted = false;
  try {
    // One bounded batch per scheduled invocation, independent of the browser.
    const signal = AbortSignal.timeout(22000);
    const campaign = await checked(
      client.from("campaigns").select("*").eq("id", batch.campaign_id).single(),
    );
    const authorized = await checked(
      client
        .from("authorized_users")
        .select("user_id")
        .eq("user_id", campaign.created_by)
        .maybeSingle(),
    );
    invariant(
      authorized,
      "Campaign creator no longer has application authorization.",
    );
    const snapshots = await checked(
      client
        .from("campaign_vehicle_snapshots")
        .select("vehicles")
        .eq("campaign_id", batch.campaign_id)
        .single(),
    );
    const currentConfig = await checked(
      client
        .from("dealerships")
        .select("*")
        .eq("id", campaign.dealership_id)
        .single(),
    );
    invariant(
      canonicalJSON({ ...currentConfig, updated_at: null }) ===
        canonicalJSON({ ...campaign.config_snapshot, updated_at: null }),
      "Dealership configuration changed.",
    );
    const sync = await checked(
      client.from("stock_sync").select("key_strategy").eq("id", true).single(),
    );
    const fresh = await getFeed(signal, sync.key_strategy);
    const vehicles = snapshots.vehicles.map((s) => {
      const latest = fresh.vehicles.find((v) => v.source_id === s.source_id);
      invariant(
        latest &&
          Object.entries(s).every(([k, v]) => String(latest[k]) === String(v)),
        "Campaign stock changed or was removed.",
      );
      return latest;
    });
    await Promise.all(
      vehicles.map((v) => checkImage(v.primary_image_url, signal)),
    );
    invariant(
      batch.recipients.length <= settings.verifiedLimit,
      "Batch exceeds current verified limit.",
    );
    const payload = buildPayload(
      campaign.config_snapshot,
      vehicles,
      batch.recipients,
      campaign.id,
    );
    attempted = true;
    const response = await request(
      "https://api.postx.co.za/api/whatsapp/media-carousel/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.POSTX_BEARER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        redirect: "error",
        signal,
      },
    );
    // Any transport/HTTP/schema uncertainty remains unknown; never automatically retry.
    invariant(response.ok, "PostX returned a non-success response.");
    const results = summarizeResponse(
      await response.json(),
      payload.recipients,
    );
    await checked(
      client.rpc("finish_batch", {
        p_id: batch.id,
        p_status: "completed",
        p_results: results,
        p_error: null,
      }),
    );
  } catch {
    await checked(
      client.rpc("finish_batch", {
        p_id: batch.id,
        p_status: attempted ? "unknown" : "failed",
        p_results: [],
        p_error: attempted
          ? "Submission uncertain. Reconcile external references in PostX; do not resend automatically."
          : "Pre-submission validation failed. No PostX request was made. Check template, stock, image hosts and configuration.",
      }),
    );
  }
  return new Response("Batch processed");
}
export default async function worker() {
  return processNextBatch({ client: db() });
}
export const config = { schedule: "* * * * *" };
