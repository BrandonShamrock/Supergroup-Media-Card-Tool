import { randomUUID } from "node:crypto";
import { StockError, feed, REFRESH_FETCH_TIMEOUT_MS } from "./dealeros.js";

// Explicit whitelist: never log error messages/stacks, headers, URLs, bodies or records.
export function logStock(event, fields = {}, logger = console.info) {
  const entry = { event, component: "stock-refresh" };
  for (const key of [
    "job_id",
    "phase",
    "code",
    "bytes",
    "elapsed_ms",
    "http_status",
    "vehicle_count",
    "db_code",
  ]) {
    if (fields[key] !== undefined) entry[key] = fields[key];
  }
  logger(JSON.stringify(entry));
}
function dbFailure(error) {
  const codes = {
    "Suspicious stock reduction; existing stock retained":
      "STOCK_SHRINK_BLOCKED",
    "Duplicate stock identifiers": "STOCK_DUPLICATES",
    "Stock identifier strategy changed": "STOCK_KEY_CHANGED",
    "Stock lease expired": "STOCK_LEASE_EXPIRED",
  };
  return new StockError(
    codes[error?.message] ||
      (error?.code === "57014" ? "DATABASE_TIMEOUT" : "DATABASE_APPLY"),
    codes[error?.message]
      ? "Database stock safeguards blocked synchronization. Review the feed before retrying."
      : "Database could not commit stock synchronization. Existing stock retained.",
    {
      db_code: /^[A-Z0-9]{5}$/.test(error?.code || "") ? error.code : "UNKNOWN",
    },
  );
}
export async function runStockRefresh({
  client,
  jobId,
  userId,
  getFeed = feed,
  createSignal = () => AbortSignal.timeout(REFRESH_FETCH_TIMEOUT_MS),
  now = Date.now,
  logger = console.info,
}) {
  const claimed = await client.rpc("claim_stock_sync", {
    p_lease: jobId,
    p_user: userId,
  });
  if (claimed.error) {
    logStock("failed", { job_id: jobId, code: "DATABASE_CLAIM" }, logger);
    return;
  }
  const state = claimed.data;
  if (!state) {
    logStock("ignored", { job_id: jobId }, logger);
    return;
  }
  const start = now();
  let phase = "fetching",
    bytes = 0;
  logStock("started", { job_id: jobId, phase }, logger);
  try {
    const parsed = await getFeed(createSignal(), state.key_strategy, {
      onProgress: (progress) => {
        phase = progress.phase;
        bytes = progress.bytes ?? bytes;
        logStock(
          "progress",
          { job_id: jobId, ...progress, elapsed_ms: now() - start },
          logger,
        );
      },
    });
    phase = "applying";
    logStock(
      "progress",
      {
        job_id: jobId,
        phase,
        bytes,
        vehicle_count: parsed.vehicles.length,
        elapsed_ms: now() - start,
      },
      logger,
    );
    const progress = await client
      .from("stock_sync")
      .update({ phase, response_bytes: bytes })
      .eq("id", true)
      .eq("lease", jobId);
    if (progress.error)
      throw new StockError(
        "DATABASE_STATUS",
        "Could not record stock job progress.",
      );
    const result = await client.rpc("apply_stock_sync", {
      p_lease: jobId,
      p_strategy: parsed.strategy,
      p_vehicles: parsed.vehicles,
    });
    if (result.error) throw dbFailure(result.error);
    logStock(
      "succeeded",
      {
        job_id: jobId,
        phase: "complete",
        bytes,
        vehicle_count: parsed.vehicles.length,
        elapsed_ms: now() - start,
      },
      logger,
    );
  } catch (error) {
    const failure =
      error instanceof StockError
        ? error
        : new StockError(
            "WORKER_FAILURE",
            "Stock refresh could not complete. Check its diagnostic code in function logs.",
          );
    logStock(
      "failed",
      {
        job_id: jobId,
        phase,
        code: failure.code,
        bytes,
        ...failure.details,
        elapsed_ms: now() - start,
      },
      logger,
    );
    // Lease guard prevents a late/retried job overwriting a newer job or a committed success.
    const result = await client
      .from("stock_sync")
      .update({
        status: "failed",
        phase,
        error_code: failure.code,
        error: failure.message,
        finished_at: new Date(now()).toISOString(),
        lease: null,
        lease_until: null,
        response_bytes: failure.details.bytes ?? bytes,
      })
      .eq("id", true)
      .eq("lease", jobId);
    if (result.error)
      logStock(
        "status_failed",
        { job_id: jobId, code: "DATABASE_STATUS" },
        logger,
      );
  }
}
export function backgroundOrigin() {
  // Prefer this exact immutable deployment over production aliases. No request Host/Origin trust.
  const value = process.env.STOCK_BACKGROUND_ORIGIN || process.env.DEPLOY_URL;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new StockError(
      "BACKGROUND_CONFIG",
      "Configure STOCK_BACKGROUND_ORIGIN as the HTTPS Netlify deployment origin.",
    );
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".netlify.app") ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new StockError(
      "BACKGROUND_CONFIG",
      "Stock background origin must be an HTTPS *.netlify.app origin.",
    );
  return url.origin;
}
export async function requestStockRefresh({
  client,
  user,
  authorization,
  request = fetch,
  logger = console.info,
}) {
  const origin = backgroundOrigin(); // Fail before leasing if deployment config is invalid.
  const queued = await client.rpc("request_stock_sync", {
    p_lease: randomUUID(),
    p_user: user.id,
  });
  if (queued.error)
    throw new StockError(
      "DATABASE_REQUEST",
      "Could not queue the background stock job. Check the upgrade migration and database availability.",
    );
  const job = queued.data;
  if (!job.dispatch) return { job_id: job.job_id, queued: true };
  let accepted = false;
  try {
    const response = await request(
      `${origin}/.netlify/functions/stock-refresh-background`,
      {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ job_id: job.job_id }),
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      },
    );
    accepted = response.status === 202;
    await response.body?.cancel().catch(() => {});
    logStock(
      "dispatch",
      {
        job_id: job.job_id,
        http_status: response.status,
        code: accepted ? "BACKGROUND_ACCEPTED" : "DISPATCH_UNCONFIRMED",
      },
      logger,
    );
  } catch {
    logStock(
      "dispatch",
      { job_id: job.job_id, code: "DISPATCH_UNCONFIRMED" },
      logger,
    );
  }
  // A dispatch timeout does not prove the worker was not accepted; poll the persisted job.
  return { job_id: job.job_id, queued: true, dispatch_confirmed: accepted };
}
