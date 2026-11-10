import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { invariant } from "../../../shared/domain.js";

export async function verifyImage(
  value,
  signal,
  { resolve = lookup, request = fetch } = {},
) {
  const url = new URL(value);
  const hosts = (process.env.STOCK_IMAGE_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  invariant(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      hosts.includes(url.hostname) &&
      !isIP(url.hostname),
    "Image host is not approved.",
  );
  if (url.searchParams.has("Signature")) {
    let expiry = Number(url.searchParams.get("Expires"));
    if (!expiry && url.searchParams.has("Policy")) {
      try {
        const policy = JSON.parse(
          Buffer.from(
            url.searchParams
              .get("Policy")
              .replace(/-/g, "+")
              .replace(/_/g, "=")
              .replace(/~/g, "/"),
            "base64",
          ).toString("utf8"),
        );
        expiry = Math.min(
          ...policy.Statement.map(
            (s) => s.Condition.DateLessThan["AWS:EpochTime"],
          ),
        );
      } catch {
        throw new Error("Cannot verify signed image expiry.");
      }
    }
    const minimum = Number(process.env.MEDIA_MIN_VALIDITY_SECONDS || 900);
    invariant(
      Number.isFinite(minimum) &&
        minimum >= 900 &&
        Number.isFinite(expiry) &&
        expiry > Date.now() / 1000 + minimum,
      "Signed image expires before the configured retrieval window.",
    );
  }
  const addresses = await resolve(url.hostname, { all: true });
  invariant(
    addresses.length > 0 &&
      addresses.every(({ address }) => {
        // Only globally routed IPv4. Reject IPv6 and private/link-local/reserved destinations.
        const [a, b] = address.split(".").map(Number);
        return (
          isIP(address) === 4 &&
          a !== 0 &&
          a !== 10 &&
          a !== 127 &&
          a < 224 &&
          !(a === 169 && b === 254) &&
          !(a === 172 && b >= 16 && b <= 31) &&
          !(a === 192 && (b === 168 || b === 0)) &&
          !(a === 100 && b >= 64 && b <= 127) &&
          !(a === 198 && (b === 18 || b === 19))
        );
      }),
    "Image destination is not public.",
  );
  const response = await request(url, { signal, redirect: "error" });
  invariant(response.ok, "Primary image is unavailable or expired.");
  const type = (response.headers.get("content-type") || "")
    .split(";")[0]
    .toLowerCase();
  invariant(
    ["image/jpeg", "image/png"].includes(type),
    "Image must be JPEG or PNG.",
  );
  const reader = response.body.getReader();
  let size = 0,
    signature = [];
  try {
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      size += chunk.length;
      if (signature.length < 8)
        signature.push(...chunk.slice(0, 8 - signature.length));
      invariant(size <= 5 * 1024 * 1024, "Image exceeds 5 MiB.");
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  invariant(size > 0, "Image is empty.");
  invariant(
    type === "image/jpeg"
      ? signature[0] === 255 && signature[1] === 216 && signature[2] === 255
      : signature.join(",") === "137,80,78,71,13,10,26,10",
    "Image content does not match JPEG/PNG.",
  );
}
