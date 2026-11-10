import { randomUUID, createHash } from "node:crypto";
import {
  db,
  checked,
  authorize,
  json,
  readInput,
  inputError,
  safeMessage,
  refresh,
  sendingSettings,
  allRows,
  prepare,
  feed,
} from "./lib/core.js";
import { verifyImage } from "./lib/media.js";
import { invariant, splitBatches, buildPayload } from "../../shared/domain.js";

export default async function handler(request) {
  try {
    const client = db(),
      user = await authorize(request, client);
    const action = new URL(request.url).searchParams.get("action");
    if (request.method === "GET" && action === "dashboard") {
      const [dealerships, vehicles, sync, campaigns] = await Promise.all([
        allRows(client, "dealerships"),
        allRows(client, "vehicle_stock"),
        checked(
          client
            .from("stock_sync")
            .select("last_success_at,vehicle_count,error,lease_until")
            .eq("id", true)
            .single(),
        ),
        checked(
          client
            .from("campaigns")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100),
        ),
      ]);
      return json({
        dealerships,
        vehicles,
        sync,
        campaigns,
        sending: sendingSettings(),
      });
    }
    if (request.method === "GET" && action === "details") {
      const id = new URL(request.url).searchParams.get("id");
      const [snapshot, batches] = await Promise.all([
        checked(
          client
            .from("campaign_vehicle_snapshots")
            .select("*")
            .eq("campaign_id", id)
            .single(),
        ),
        checked(
          client
            .from("campaign_batches")
            .select(
              "id,position,status,recipient_count,started_at,finished_at,error,recipient_references,recipient_results(*)",
            )
            .eq("campaign_id", id)
            .order("position"),
        ),
      ]);
      return json({ snapshot, batches });
    }
    if (request.method !== "POST")
      return json({ error: "Unsupported operation." }, 405);
    if (action === "refresh") return json(await refresh(client));
    const body = await readInput(request);
    if (action === "cancel") {
      invariant(
        typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id),
        "Choose a valid campaign.",
      );
      await checked(client.rpc("cancel_campaign", { p_id: body.id }));
      return json({ cancelled: true });
    }
    if (action === "settings") {
      invariant(
        typeof body.id === "string",
        "Choose a dealership configuration.",
      );
      const mapping = body.variable_mapping;
      invariant(
        mapping && JSON.stringify(mapping).length <= 8000,
        "Invalid template variable configuration.",
      );
      const patch = {
        dealeros_id: String(body.dealeros_id || "").trim() || null,
        postx_group_id: Number(body.postx_group_id),
        template_name: String(body.template_name || "").trim(),
        card_count: Number(body.card_count),
        variable_mapping: mapping,
        active: body.active === true,
        mapping_verified: body.mapping_verified === true,
        template_verified: body.template_verified === true,
        updated_at: new Date().toISOString(),
      };
      invariant(
        Number.isSafeInteger(patch.postx_group_id) &&
          patch.postx_group_id > 0 &&
          Number.isInteger(patch.card_count) &&
          patch.card_count >= 2 &&
          patch.card_count <= 10,
        "Invalid group ID or card count.",
      );
      if (patch.mapping_verified) {
        const exists = await checked(
          client
            .from("vehicle_stock")
            .select("source_id")
            .eq("dealership_id", patch.dealeros_id)
            .limit(1),
        );
        invariant(
          exists.length > 0,
          "DealerOS mapping must match a dealership in the actual feed.",
        );
      }
      // Full schema validation even when configuration is saved inactive/unverified.
      if (patch.template_verified || patch.active) {
        const { validateConfig } = await import("../../shared/domain.js");
        validateConfig({
          ...patch,
          active: true,
          mapping_verified: true,
          template_verified: true,
        });
      }
      await checked(
        client
          .from("dealerships")
          .update(patch)
          .eq("id", body.id)
          .select("id")
          .single(),
      );
      return json({ saved: true });
    }
    if (action === "preview" || action === "queue") {
      const prepared = await prepare(client, body),
        settings = sendingSettings();
      const { config, vehicles, recipients } = prepared;
      const limitValid =
        Number.isInteger(settings.verifiedLimit) &&
        settings.verifiedLimit > 0 &&
        settings.verifiedLimit <= 500 &&
        settings.batchSize > 0 &&
        settings.batchSize <= settings.verifiedLimit;
      if (action === "preview")
        return json({
          vehicle_count: vehicles.length,
          recipient_count: recipients.length,
          batch_count: limitValid
            ? Math.ceil(recipients.length / settings.batchSize)
            : null,
          warnings: [
            ...(!settings.enabled ? ["Live sending is disabled."] : []),
            ...(!limitValid
              ? ["Media-carousel batch limit is not verified/configured."]
              : []),
            "Images are refreshed and validated at submission and again by the worker. Accepted does not mean delivered.",
          ],
        });
      invariant(
        settings.enabled && process.env.POSTX_BEARER_TOKEN,
        "Live sending is disabled or server credentials are missing.",
      );
      invariant(
        body.confirmation === "SEND TO REAL CUSTOMERS",
        "Explicit final confirmation is required.",
      );
      invariant(
        typeof body.campaign_name === "string" &&
          body.campaign_name.trim().length > 0 &&
          body.campaign_name.length <= 120,
        "Enter a campaign name (1–120 characters).",
      );
      invariant(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          body.request_id,
        ),
        "A valid idempotency reference is required.",
      );
      const existing = await checked(
        client
          .from("campaigns")
          .select("id,created_by")
          .eq("id", body.request_id)
          .maybeSingle(),
      );
      if (existing) {
        invariant(
          existing.created_by === user.id,
          "Campaign reference conflict.",
        );
        return json({ id: existing.id });
      }
      const sync = await checked(
        client
          .from("stock_sync")
          .select("key_strategy")
          .eq("id", true)
          .single(),
      );
      const signal = AbortSignal.timeout(18000);
      const latest = await feed(signal, sync.key_strategy);
      const current = vehicles.map((v) =>
        latest.vehicles.find((f) => f.source_id === v.source_id),
      );
      invariant(
        current.every(
          (v, i) =>
            v &&
            v.dealership_id === config.dealeros_id &&
            [
              "make",
              "model",
              "derivative",
              "year",
              "mileage",
              "retail_price",
            ].every((k) => String(v[k]) === String(vehicles[i][k])),
        ),
        "Selected stock changed or disappeared. Refresh stock and review again.",
      );
      await Promise.all(
        current.map((v) => verifyImage(v.primary_image_url, signal)),
      );
      const cid = body.request_id;
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            user: user.id,
            name: body.campaign_name.trim(),
            dealer: config.id,
            template: config.template_name,
            vehicles: body.vehicle_ids,
            recipients: [...recipients].sort((a, b) =>
              a.whatsapp_number.localeCompare(b.whatsapp_number),
            ),
          }),
        )
        .digest("hex");
      const referenced = recipients.map((r) => ({
        ...r,
        external_reference: `${cid}-${randomUUID()}`,
      }));
      const batches = splitBatches(
        referenced,
        settings.batchSize,
        settings.verifiedLimit,
      );
      batches.forEach((batch) => buildPayload(config, current, batch, cid));
      const snapshot = current.map(
        ({ primary_image_url, updated_at, ...v }) => v,
      );
      const id = await checked(
        client.rpc("queue_campaign", {
          p_campaign: {
            id: cid,
            request_fingerprint: fingerprint,
            created_by: user.id,
            dealership_id: config.id,
            name: body.campaign_name.trim(),
            config_snapshot: config,
            recipient_count: recipients.length,
          },
          p_vehicles: snapshot,
          p_batches: batches,
        }),
      );
      return json({ id });
    }
    return json({ error: "Unknown operation." }, 404);
  } catch (e) {
    return json({ error: safeMessage(e) }, e.status || 400);
  }
}
