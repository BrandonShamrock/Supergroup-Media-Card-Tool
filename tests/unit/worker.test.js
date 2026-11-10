import test from "node:test";
import assert from "node:assert/strict";
import { processNextBatch } from "../../netlify/functions/campaign-worker.js";
const config = {
  id: "dealer",
  name: "Dealer",
  active: true,
  mapping_verified: true,
  template_verified: true,
  dealeros_id: "10",
  postx_group_id: 123,
  template_name: "approved",
  card_count: 2,
  variable_mapping: { recipient: {}, card: { year: "year" } },
  updated_at: "now",
};
const vehicles = [1, 2].map((i) => ({
  source_id: String(i),
  dealership_id: "10",
  make: "Toyota",
  model: "Test",
  year: 2024,
  mileage: 1000,
  primary_image_url: "https://images.example.test/a.jpg",
}));
const recipient = {
  name: "Invented Customer",
  whatsapp_number: "+27821234567",
  external_reference: "test-reference",
};
function fixture(changed = false) {
  let claimed = false;
  const outcomes = [];
  const client = {
    rpc: async (name, args) => {
      if (name === "claim_batch") {
        if (claimed) return { data: null };
        claimed = true;
        return {
          data: {
            id: "batch",
            campaign_id: "campaign",
            recipients: [recipient],
          },
        };
      }
      if (name === "finish_batch") outcomes.push(args);
      return { data: null, error: null };
    },
    from: (table) => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      async maybeSingle() {
        return { data: { user_id: "user" }, error: null };
      },
      async single() {
        const data = {
          campaigns: {
            id: "campaign",
            dealership_id: "dealer",
            config_snapshot: { ...config },
          },
          campaign_vehicle_snapshots: {
            vehicles: vehicles.map(({ primary_image_url, ...v }) => v),
          },
          dealerships: { ...config, card_count: changed ? 3 : 2 },
          stock_sync: { key_strategy: "stock_id" },
        }[table];
        return { data, error: null };
      },
    }),
  };
  return { client, outcomes };
}
function enable() {
  process.env.POSTX_LIVE_SENDING_ENABLED = "true";
  process.env.POSTX_VERIFIED_BATCH_LIMIT = "1";
  process.env.POSTX_BATCH_SIZE = "1";
  process.env.POSTX_BEARER_TOKEN = "invented-test-token";
}
function reset() {
  for (const k of [
    "POSTX_LIVE_SENDING_ENABLED",
    "POSTX_VERIFIED_BATCH_LIMIT",
    "POSTX_BATCH_SIZE",
    "POSTX_BEARER_TOKEN",
  ])
    delete process.env[k];
}
test("worker is disabled by default and performs no send", async () => {
  reset();
  const f = fixture();
  let calls = 0;
  await processNextBatch({
    ...f,
    request: async () => {
      calls++;
      throw new Error();
    },
  });
  assert.equal(calls, 0);
  assert.equal(f.outcomes.length, 0);
});
test("worker records correlated accepted results, sends once and does not claim again", async () => {
  enable();
  try {
    const f = fixture();
    let calls = 0;
    const deps = {
      ...f,
      getFeed: async () => ({ vehicles }),
      checkImage: async () => {},
      request: async (_url, options) => {
        calls++;
        const payload = JSON.parse(options.body);
        assert.equal(
          payload.recipients[0].external_reference,
          "test-reference",
        );
        return new Response(
          JSON.stringify({
            recipients: [
              {
                external_reference: "test-reference",
                status: "accepted",
                conversation_id: 7,
              },
            ],
          }),
        );
      },
    };
    await processNextBatch(deps);
    await processNextBatch(deps);
    assert.equal(calls, 1);
    assert.equal(f.outcomes[0].p_status, "completed");
    assert.equal(f.outcomes[0].p_results[0].status, "accepted");
  } finally {
    reset();
  }
});
test("timeout after attempt is unknown and never automatically resubmitted", async () => {
  enable();
  try {
    const f = fixture();
    let calls = 0;
    const deps = {
      ...f,
      getFeed: async () => ({ vehicles }),
      checkImage: async () => {},
      request: async () => {
        calls++;
        throw new Error("simulated timeout");
      },
    };
    await processNextBatch(deps);
    await processNextBatch(deps);
    assert.equal(calls, 1);
    assert.equal(f.outcomes[0].p_status, "unknown");
  } finally {
    reset();
  }
});
test("configuration mismatch fails before any PostX request", async () => {
  enable();
  try {
    const f = fixture(true);
    let calls = 0;
    await processNextBatch({
      ...f,
      getFeed: async () => ({ vehicles }),
      checkImage: async () => {},
      request: async () => {
        calls++;
        throw new Error();
      },
    });
    assert.equal(calls, 0);
    assert.equal(f.outcomes[0].p_status, "failed");
  } finally {
    reset();
  }
});
