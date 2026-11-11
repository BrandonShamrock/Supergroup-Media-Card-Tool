import { createClient } from "@supabase/supabase-js";
import {
  invariant,
  buildPayload,
  splitBatches,
  normalizePhone,
} from "../../../shared/domain.js";

export function db() {
  invariant(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Server database configuration is missing.",
  );
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function checked(query) {
  const { data, error } = await query;
  if (error)
    throw new Error(
      "Database operation failed. Check migrations and server configuration.",
    );
  return data;
}
export async function authorize(request, client) {
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer "))
    throw Object.assign(new Error("Sign in is required."), { status: 401 });
  const { data, error } = await client.auth.getUser(bearer.slice(7));
  if (error || !data.user)
    throw Object.assign(new Error("Your session is invalid. Sign in again."), {
      status: 401,
    });
  const allowed = await checked(
    client
      .from("authorized_users")
      .select("user_id")
      .eq("user_id", data.user.id)
      .maybeSingle(),
  );
  if (!allowed)
    throw Object.assign(
      new Error("This account is not authorized for this application."),
      { status: 403 },
    );
  return data.user;
}
export const safeMessage = (e) =>
  e?.status
    ? e.message
    : "The operation could not complete. Check configuration or try again. No uncertain submission will be automatically retried.";
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}
export async function readInput(request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw inputError("JSON input is required.");
  const text = await request.text();
  if (Buffer.byteLength(text) > 4 * 1024 * 1024)
    throw inputError("Request is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw inputError("Invalid JSON input.");
  }
}
export { feed } from "./dealeros.js";
export function sendingSettings() {
  const verifiedLimit = Number(process.env.POSTX_VERIFIED_BATCH_LIMIT || 0);
  const batchSize = Number(process.env.POSTX_BATCH_SIZE || 0);
  const enabled = process.env.POSTX_LIVE_SENDING_ENABLED === "true";
  return { enabled, verifiedLimit, batchSize };
}
export async function allRows(client, table) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const part = await checked(
      client
        .from(table)
        .select("*")
        .order(table === "vehicle_stock" ? "source_id" : "id")
        .range(offset, offset + 999),
    );
    rows.push(...part);
    if (part.length < 1000) return rows;
    invariant(rows.length <= 100000, "Database result exceeds supported size.");
  }
}
export async function prepare(client, body) {
  const config = await checked(
    client
      .from("dealerships")
      .select("*")
      .eq("id", body.dealership_id)
      .single(),
  );
  invariant(
    Array.isArray(body.vehicle_ids) &&
      body.vehicle_ids.length >= 2 &&
      body.vehicle_ids.length <= 10,
    "Choose 2–10 vehicles.",
  );
  const rows = await checked(
    client.from("vehicle_stock").select("*").in("source_id", body.vehicle_ids),
  );
  const vehicles = body.vehicle_ids.map((id) =>
    rows.find((v) => v.source_id === id),
  );
  invariant(
    vehicles.every(Boolean),
    "A selected vehicle is no longer in stock.",
  );
  invariant(
    Array.isArray(body.recipients) &&
      body.recipients.length > 0 &&
      body.recipients.length <= 10000,
    "Import 1–10,000 valid recipients.",
  );
  const seen = new Set();
  const recipients = body.recipients.map((r) => {
    const phone = normalizePhone(r.whatsapp_number),
      name = String(r.name || "").trim();
    invariant(
      name &&
        name.length <= 120 &&
        phone &&
        phone === r.whatsapp_number &&
        !seen.has(phone),
      "Invalid or duplicated recipients.",
    );
    seen.add(phone);
    return { name, whatsapp_number: phone };
  });
  buildPayload(config, vehicles, recipients.slice(0, 1), "validation");
  return { config, vehicles, recipients };
}
