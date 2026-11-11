import test from "node:test";
import assert from "node:assert/strict";
import {
  feed,
  readFeedBody,
  MAX_FEED_BYTES,
  REFRESH_FETCH_TIMEOUT_MS,
  StockError,
} from "../../netlify/functions/lib/dealeros.js";
import {
  runStockRefresh,
  requestStockRefresh,
  logStock,
  backgroundOrigin,
} from "../../netlify/functions/lib/stock-refresh.js";
const jobId = "11111111-1111-4111-8111-111111111111";
const row = {
  id: 1,
  stock_id: "S1",
  dealership_id: "10",
  dealership_name: "Dealer",
  make: "Toyota",
  model: "Test",
  year: 2024,
  mileage: 1000,
  retail_price: 10000,
  listingImages: [
    { order: 2, url: "https://images.example.test/not-primary.jpg" },
    { order: 1, url: "https://images.example.test/primary.jpg" },
  ],
};
const token = "invented-sensitive-token";
const normal = () =>
  feed(undefined, undefined, {
    token,
    request: async () => new Response(JSON.stringify([row])),
  });
function fixture({ claim = true, dbError = null } = {}) {
  const calls = [],
    updates = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_stock_sync")
        return { data: claim ? { key_strategy: null } : null, error: null };
      if (name === "request_stock_sync")
        return { data: { job_id: jobId, dispatch: true }, error: null };
      return { data: null, error: dbError };
    },
    from: () => ({
      update(patch) {
        updates.push(patch);
        return {
          eq() {
            return this;
          },
          then(resolve) {
            resolve({ data: null, error: null });
          },
        };
      },
    }),
  };
  return { client, calls, updates };
}
test("31 MiB decompressed response is streamed, fully validated and reduced to normalized stock", async () => {
  const payload = JSON.stringify([
    { ...row, unused: "x".repeat(31 * 1024 * 1024) },
  ]);
  const bytes = Buffer.from(payload);
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 64 * 1024)
        controller.enqueue(bytes.subarray(i, i + 64 * 1024));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const parsed = await feed(undefined, null, {
    token,
    request: async () =>
      new Response(stream, { headers: { "Content-Length": "1" } }),
  });
  assert.equal(parsed.vehicles.length, 1);
  assert.equal(
    parsed.vehicles[0].primary_image_url,
    "https://images.example.test/primary.jpg",
  );
  assert.equal(parsed.vehicles[0].unused, undefined);
  assert.equal(parsed.strategy, "stock_id");
  assert.ok(Buffer.byteLength(JSON.stringify(parsed.vehicles)) < 1000);
  assert.ok(MAX_FEED_BYTES >= 32 * 1024 * 1024);
});
test("stream safety limit cancels reading before unlimited buffering", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(c) {
      c.enqueue(new Uint8Array(1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readFeedBody(new Response(stream), { maxBytes: 2048 }),
    (e) => e.code === "FEED_TOO_LARGE",
  );
  assert.equal(cancelled, true);
});
test("45-second upstream latency is supported by the background fetch budget (virtual clock)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(),
    REFRESH_FETCH_TIMEOUT_MS,
  );
  const f = fixture(),
    logs = [];
  const execution = runStockRefresh({
    ...f,
    jobId,
    userId: "user",
    createSignal: () => controller.signal,
    logger: (line) => logs.push(JSON.parse(line)),
    getFeed: (signal, strategy, options) =>
      feed(signal, strategy, {
        ...options,
        token,
        request: async () => {
          await new Promise((resolve) => setTimeout(resolve, 45000));
          return new Response(JSON.stringify([row]));
        },
      }),
  });
  // Let the asynchronous database claim complete before advancing the upstream clock.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(45000);
  await execution;
  clearTimeout(deadline);
  assert.equal(
    f.calls.filter((c) => c.name === "apply_stock_sync").length,
    1,
    JSON.stringify({ logs, updates: f.updates }),
  );
  assert.ok(logs.some((l) => l.event === "succeeded" && l.elapsed_ms >= 45000));
});
test("timeout while downloading cancels the stream and reports a distinct diagnostic", async () => {
  const controller = new AbortController();
  let cancel = false;
  const stream = new ReadableStream({
    pull() {},
    cancel() {
      cancel = true;
    },
  });
  const pending = feed(controller.signal, null, {
    token,
    request: async () => new Response(stream),
  });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, (e) => e.code === "UPSTREAM_TIMEOUT");
  assert.equal(cancel, true);
});
test("HTTP, malformed JSON, field validation and transport errors are distinguished", async () => {
  for (const [request, code] of [
    [
      async () => new Response("secret upstream body", { status: 503 }),
      "UPSTREAM_HTTP",
    ],
    [async () => new Response("[truncated"), "FEED_JSON"],
    [async () => new Response("[]"), "FEED_VALIDATION"],
    [
      async () => {
        throw new Error("https://sensitive.example.test/?signature=secret");
      },
      "UPSTREAM_NETWORK",
    ],
  ])
    await assert.rejects(
      feed(undefined, null, { token, request }),
      (e) => e.code === code,
    );
});
test("failed fetch never invokes apply and persists a safe error without tokens, URLs or raw messages", async () => {
  const f = fixture(),
    logs = [];
  await runStockRefresh({
    ...f,
    jobId,
    userId: "user",
    logger: (s) => logs.push(s),
    getFeed: async () => {
      throw new StockError("UPSTREAM_HTTP", "DealerOS returned HTTP 401.", {
        http_status: 401,
      });
    },
  });
  assert.equal(f.calls.filter((c) => c.name === "apply_stock_sync").length, 0);
  assert.equal(f.updates.at(-1).status, "failed");
  assert.equal(f.updates.at(-1).error_code, "UPSTREAM_HTTP");
  logStock(
    "failed",
    {
      job_id: jobId,
      code: "SAFE",
      error: token,
      url: "https://secret.example.test",
    },
    (s) => logs.push(s),
  );
  assert.ok(
    logs.every(
      (s) =>
        !s.includes(token) &&
        !s.includes("https://") &&
        !s.includes("Authorization"),
    ),
  );
});
test("database deletion safeguard failures retain their own code; duplicate jobs do not fetch", async () => {
  const f = fixture({
    dbError: {
      code: "P0001",
      message: "Suspicious stock reduction; existing stock retained",
    },
  });
  await runStockRefresh({
    ...f,
    jobId,
    userId: "user",
    getFeed: normal,
    logger: () => {},
  });
  assert.equal(f.updates.at(-1).error_code, "STOCK_SHRINK_BLOCKED");
  let fetched = false;
  const duplicate = fixture({ claim: false });
  await runStockRefresh({
    ...duplicate,
    jobId,
    userId: "user",
    getFeed: async () => {
      fetched = true;
    },
    logger: () => {},
  });
  assert.equal(fetched, false);
  assert.equal(duplicate.updates.length, 0);
});
test("background dispatch contains only a job ID and a timeout is unconfirmed, never reported as success", async () => {
  process.env.STOCK_BACKGROUND_ORIGIN = "https://site.example.netlify.app";
  try {
    const f = fixture();
    let body;
    const result = await requestStockRefresh({
      ...f,
      user: { id: "user" },
      authorization: "Bearer test",
      logger: () => {},
      request: async (_url, options) => {
        body = options.body;
        throw new Error("transport timeout");
      },
    });
    assert.deepEqual(JSON.parse(body), { job_id: jobId });
    assert.equal(result.dispatch_confirmed, false);
    assert.equal(result.queued, true);
    assert.equal(f.updates.length, 0);
    process.env.STOCK_BACKGROUND_ORIGIN = "https://attacker.example.test";
    assert.throws(backgroundOrigin, (e) => e.code === "BACKGROUND_CONFIG");
  } finally {
    delete process.env.STOCK_BACKGROUND_ORIGIN;
  }
});

test("stock pages remain bounded and cursor traversal returns every normalized row once", async () => {
  const { stockPage, MAX_STOCK_PAGE_BYTES } =
    await import("../../netlify/functions/lib/stock-read.js");
  const rows = Array.from({ length: 401 }, (_, i) => ({
    source_id: String(i).padStart(4, "0"),
    primary_image_url:
      "https://images.example.test/?Signature=" + "x".repeat(10000),
  }));
  const client = {
    from: () => {
      let cursor = "";
      const query = {
        select() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        gt(_field, value) {
          cursor = value;
          return this;
        },
        then(resolve) {
          resolve({
            data: rows
              .filter((r) => !cursor || r.source_id > cursor)
              .slice(0, 200),
            error: null,
          });
        },
      };
      return query;
    },
  };
  const all = [];
  let cursor = null;
  do {
    const page = await stockPage(client, cursor);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= MAX_STOCK_PAGE_BYTES);
    all.push(...page.vehicles);
    cursor = page.next_cursor;
  } while (cursor);
  assert.equal(all.length, 401);
  assert.equal(new Set(all.map((r) => r.source_id)).size, 401);
});
