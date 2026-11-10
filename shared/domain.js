import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export function invariant(ok, message) {
  if (!ok) throw new Error(message);
}
export function primaryImage(images) {
  const image = Array.isArray(images) && images.find((i) => i.order === 1);
  const url = image && (image.url || image.image_url);
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
export function parseStock(payload, previousStrategy) {
  invariant(
    !payload?.next_page_url &&
      !payload?.links?.next &&
      !payload?.meta?.next_page_url,
    "Paginated stock response is not supported.",
  );
  const rows = Array.isArray(payload)
    ? payload
    : payload?.data || payload?.listings;
  invariant(
    Array.isArray(rows) && rows.length > 0,
    "Stock feed is empty or malformed; existing stock retained.",
  );
  const total = payload?.total ?? payload?.meta?.total;
  invariant(
    total == null || Number(total) === rows.length,
    "Stock response is incomplete.",
  );
  const unique = (field) =>
    rows.every(
      (r) =>
        r &&
        ["string", "number"].includes(typeof r[field]) &&
        String(r[field]).trim(),
    ) && new Set(rows.map((r) => String(r[field]))).size === rows.length;
  const strategy = previousStrategy || (unique("stock_id") ? "stock_id" : "id");
  invariant(
    ["stock_id", "id"].includes(strategy) && unique(strategy),
    "Stable stock identifiers are missing or duplicated.",
  );
  return {
    strategy,
    vehicles: rows.map((r) => {
      invariant(
        r.dealership_id != null &&
          String(r.dealership_name || "").trim() &&
          String(r.make || "").trim() &&
          String(r.model || r.title || "").trim(),
        "Stock has incomplete vehicle or dealership fields.",
      );
      const number = (value, field) => {
        invariant(
          value !== null &&
            value !== "" &&
            Number.isFinite(Number(value)) &&
            Number(value) >= 0,
          `Invalid stock ${field}.`,
        );
        return Number(value);
      };
      const year = number(r.year, "year");
      invariant(
        Number.isInteger(year) &&
          year >= 1900 &&
          year <= new Date().getFullYear() + 2,
        "Invalid stock year.",
      );
      return {
        source_id: String(r[strategy]),
        dealership_id: String(r.dealership_id),
        dealership_name: String(r.dealership_name).trim(),
        make: String(r.make),
        model: String(r.model || ""),
        derivative: String(r.derivative || ""),
        title: String(r.title || ""),
        year,
        mileage: number(r.mileage, "mileage"),
        retail_price: number(r.retail_price, "price"),
        new_used: String(r.new_used || r.condition || ""),
        stock_number: String(r.stock_number || ""),
        colour: String(r.colour || ""),
        primary_image_url: primaryImage(r.listingImages),
      };
    }),
  };
}
export const normalizeName = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function dealershipCandidates(name, vehicles) {
  const found = new Map();
  for (const v of vehicles)
    if (normalizeName(v.dealership_name) === normalizeName(name))
      found.set(v.dealership_id, {
        id: v.dealership_id,
        name: v.dealership_name,
      });
  return [...found.values()]; // Candidate only; never verification.
}
export function normalizePhone(value) {
  const raw = String(value ?? "")
    .trim()
    .replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(raw)) return null;
  const input = raw.startsWith("00")
    ? "+" + raw.slice(2)
    : raw.startsWith("27") && raw.length === 11
      ? "+" + raw
      : raw;
  // International numbers must have an explicit country prefix; local fallback is ZA only.
  const phone = parsePhoneNumberFromString(
    input,
    input.startsWith("+") ? undefined : "ZA",
  );
  return phone?.isValid() ? phone.number : null;
}
export function importRecipients(rows, nameColumn, phoneColumn) {
  invariant(
    Array.isArray(rows) && rows.length <= 10001,
    "Maximum 10,000 recipient rows per campaign.",
  );
  invariant(
    Number.isInteger(nameColumn) &&
      Number.isInteger(phoneColumn) &&
      nameColumn !== phoneColumn,
    "Map distinct name and phone columns.",
  );
  const seen = new Set(),
    recipients = [],
    invalid = [];
  let duplicates = 0;
  rows.forEach((row, index) => {
    const name = String(row[nameColumn] ?? "").trim(),
      phone = normalizePhone(row[phoneColumn]);
    if (!name || name.length > 120 || !phone) {
      invalid.push({
        row: index + 2,
        reason:
          !name || name.length > 120
            ? "Missing or invalid name"
            : "Invalid number",
      });
      return;
    }
    if (seen.has(phone)) {
      duplicates++;
      return;
    }
    seen.add(phone);
    recipients.push({ name, whatsapp_number: phone });
  });
  return { recipients, invalid, duplicates };
}
const cardFields = [
  "car_type",
  "year",
  "mileage",
  "retail_price",
  "make",
  "model",
  "derivative",
  "stock_number",
];
const recipientFields = ["name", "dealership_name"];
export function validateConfig(c) {
  invariant(
    c?.active && c.mapping_verified && c.template_verified,
    "Verify the dealership mapping and approved template before sending.",
  );
  invariant(
    c.dealeros_id &&
      Number.isSafeInteger(c.postx_group_id) &&
      c.postx_group_id > 0,
    "Missing dealership or PostX group ID.",
  );
  invariant(
    /^[A-Za-z0-9_]{1,150}$/.test(c.template_name || ""),
    "Enter the approved template name.",
  );
  invariant(
    Number.isInteger(c.card_count) && c.card_count >= 2 && c.card_count <= 10,
    "Template must require 2–10 cards.",
  );
  for (const [kind, allowed] of [
    ["card", cardFields],
    ["recipient", recipientFields],
  ]) {
    const mappings = c.variable_mapping?.[kind];
    invariant(
      mappings &&
        typeof mappings === "object" &&
        !Array.isArray(mappings) &&
        Object.keys(mappings).length <= 30,
      `Configure ${kind} variable mappings.`,
    );
    for (const [key, source] of Object.entries(mappings))
      invariant(
        /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) &&
          (allowed.includes(source) ||
            (typeof source === "string" &&
              source.startsWith("literal:") &&
              source.length <= 200)),
        `Invalid ${kind} variable mapping.`,
      );
  }
}
function variables(mapping, values) {
  return Object.fromEntries(
    Object.entries(mapping).map(([key, source]) => {
      const value = source.startsWith("literal:")
        ? source.slice(8)
        : values[source];
      invariant(
        value != null && String(value).length > 0,
        `Missing value for template variable ${key}.`,
      );
      return [key, String(value)];
    }),
  );
}
export function buildPayload(config, vehicles, recipients, campaignId) {
  validateConfig(config);
  invariant(
    vehicles.length === config.card_count &&
      new Set(vehicles.map((v) => v.source_id)).size === vehicles.length,
    "Selection must match the template card count, with no duplicates.",
  );
  invariant(
    recipients.length > 0 && recipients.length <= 500,
    "Invalid recipient batch size.",
  );
  return {
    group_id: config.postx_group_id,
    template_name: config.template_name,
    recipients: recipients.map((r, index) => {
      invariant(
        r.name &&
          r.name.length <= 120 &&
          normalizePhone(r.whatsapp_number) === r.whatsapp_number,
        "Invalid recipient.",
      );
      return {
        name: r.name,
        whatsapp_number: r.whatsapp_number,
        variables: variables(config.variable_mapping.recipient, {
          name: r.name,
          dealership_name: config.name,
        }),
        external_reference: r.external_reference || `${campaignId}-${index}`,
      };
    }),
    carousel: vehicles.map((v) => {
      invariant(
        v.dealership_id === config.dealeros_id &&
          v.primary_image_url?.startsWith("https://"),
        "Vehicle has the wrong dealership or no primary HTTPS image.",
      );
      return {
        image_url: v.primary_image_url,
        variables: variables(config.variable_mapping.card, {
          ...v,
          car_type:
            [v.make, v.model, v.derivative].filter(Boolean).join(" ") ||
            v.title,
        }),
      };
    }),
  };
}
export function splitBatches(recipients, size, verifiedLimit) {
  invariant(
    Number.isInteger(verifiedLimit) &&
      verifiedLimit > 0 &&
      verifiedLimit <= 500,
    "PostX media-carousel endpoint limit has not been verified.",
  );
  invariant(
    Number.isInteger(size) && size >= 1 && size <= verifiedLimit,
    "Batch size exceeds verified limit.",
  );
  return Array.from({ length: Math.ceil(recipients.length / size) }, (_, i) =>
    recipients.slice(i * size, (i + 1) * size),
  );
}
export function summarizeResponse(body, submitted) {
  const rows = Array.isArray(body?.recipients) ? body.recipients : [];
  const refs = new Set(submitted.map((r) => r.external_reference));
  const known = new Map();
  for (const r of rows) {
    if (!refs.has(r.external_reference) || known.has(r.external_reference))
      throw new Error("Uncorrelated PostX response.");
    known.set(r.external_reference, r);
  }
  return submitted.map((r) => {
    const match = known.get(r.external_reference);
    return {
      external_reference: r.external_reference,
      status: ["accepted", "failed"].includes(match?.status)
        ? match.status
        : "unknown",
      conversation_id:
        match?.conversation_id == null
          ? null
          : String(match.conversation_id).slice(0, 100),
      error:
        match?.status === "failed"
          ? "PostX rejected recipient; inspect in PostX using the reference."
          : null,
    };
  });
}

export function canonicalJSON(value) {
  const normalize = (v) =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, normalize(v[k])]),
          )
        : v;
  return JSON.stringify(normalize(value));
}
