import { parseStock } from "../../../shared/domain.js";

export const MAX_FEED_BYTES = 64 * 1024 * 1024;
// Used only by the background refresh. Other callers retain their existing budgets.
export const REFRESH_FETCH_TIMEOUT_MS = 180_000;
export class StockError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
export async function readFeedBody(
  response,
  { signal, maxBytes = MAX_FEED_BYTES, onBytes = () => {} } = {},
) {
  if (!response.body)
    throw new StockError(
      "UPSTREAM_BODY",
      "DealerOS returned no response body.",
    );
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      onBytes(bytes);
      if (bytes > maxBytes)
        throw new StockError(
          "FEED_TOO_LARGE",
          "DealerOS response exceeded the 64 MiB safety limit.",
          { bytes },
        );
      chunks.push(
        Buffer.from(value.buffer, value.byteOffset, value.byteLength),
      );
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function feed(
  signal,
  strategy,
  {
    request = fetch,
    token = process.env.STOCK_API_BEARER_TOKEN,
    onProgress = () => {},
    maxBytes = MAX_FEED_BYTES,
  } = {},
) {
  if (!token)
    throw new StockError(
      "STOCK_CONFIG",
      "DealerOS server credential is missing.",
    );
  let bytes = 0;
  try {
    const response = await request(
      "https://api.dealeros.co.za/api/listings/list?with=listingImages",
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new StockError(
        "UPSTREAM_HTTP",
        `DealerOS returned HTTP ${response.status}.`,
        { http_status: response.status },
      );
    }
    onProgress({ phase: "downloading", http_status: response.status });
    // Count decompressed bytes from the stream, not Content-Length (which may be compressed).
    const text = await readFeedBody(response, {
      signal,
      maxBytes,
      onBytes: (n) => {
        bytes = n;
      },
    });
    onProgress({ phase: "parsing", bytes });
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new StockError(
        "FEED_JSON",
        "DealerOS returned invalid or truncated JSON.",
        { bytes },
      );
    }
    let parsed;
    try {
      parsed = parseStock(payload, strategy);
    } catch {
      throw new StockError(
        "FEED_VALIDATION",
        "DealerOS feed failed completeness, field or unique-identifier validation.",
        { bytes },
      );
    }
    signal?.throwIfAborted();
    onProgress({
      phase: "validated",
      bytes,
      vehicle_count: parsed.vehicles.length,
    });
    return parsed;
  } catch (error) {
    if (error instanceof StockError) throw error;
    if (signal?.aborted)
      throw new StockError(
        "UPSTREAM_TIMEOUT",
        "DealerOS fetch/download exceeded its time budget.",
        { bytes },
      );
    throw new StockError(
      "UPSTREAM_NETWORK",
      "DealerOS connection or response stream failed.",
      { bytes },
    );
  }
}
