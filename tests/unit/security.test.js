import test from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../../netlify/functions/lib/core.js";
import { verifyImage } from "../../netlify/functions/lib/media.js";
test("server requires a verified Supabase user and explicit application authorization", async () => {
  const req = new Request("https://app.example.test", {
    headers: { Authorization: "Bearer invented-test-token" },
  });
  const client = (allowed) => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "test-user" } },
        error: null,
      }),
    },
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle: async () => ({
        data: allowed ? { user_id: "test-user" } : null,
        error: null,
      }),
    }),
  });
  await assert.rejects(
    authorize(new Request("https://app.example.test"), client(true)),
    (e) => e.status === 401,
  );
  await assert.rejects(authorize(req, client(false)), (e) => e.status === 403);
  assert.equal((await authorize(req, client(true))).id, "test-user");
  const expired = client(true);
  expired.auth.getUser = async () => ({ data: { user: null }, error: {} });
  await assert.rejects(authorize(req, expired), (e) => e.status === 401);
});
test("media validation rejects non-public hosts, wrong type, invalid bytes and oversized images", async () => {
  process.env.STOCK_IMAGE_ALLOWED_HOSTS = "images.example.test";
  const url = "https://images.example.test/vehicle.jpg";
  const resolve = async () => [{ address: "8.8.8.8" }];
  const request = async () =>
    new Response(new Uint8Array([255, 216, 255, 0]), {
      headers: { "Content-Type": "image/jpeg" },
    });
  await verifyImage(url, undefined, { resolve, request });
  await assert.rejects(
    verifyImage("http://images.example.test/a", undefined, {
      resolve,
      request,
    }),
  );
  await assert.rejects(
    verifyImage("https://unapproved.example.test/a", undefined, {
      resolve,
      request,
    }),
  );
  await assert.rejects(
    verifyImage(url, undefined, {
      resolve: async () => [{ address: "127.0.0.1" }],
      request,
    }),
  );
  await assert.rejects(
    verifyImage(url, undefined, {
      resolve,
      request: async () =>
        new Response("not an image", {
          headers: { "Content-Type": "image/jpeg" },
        }),
    }),
  );
  await assert.rejects(
    verifyImage(url, undefined, {
      resolve,
      request: async () =>
        new Response("html", { headers: { "Content-Type": "text/html" } }),
    }),
  );
  await assert.rejects(
    verifyImage(url, undefined, {
      resolve,
      request: async () =>
        new Response(new Uint8Array(5 * 1024 * 1024 + 1), {
          headers: { "Content-Type": "image/png" },
        }),
    }),
  );
  delete process.env.STOCK_IMAGE_ALLOWED_HOSTS;
});
test("signed media must have a verifiable expiry beyond the retrieval safety window", async () => {
  process.env.STOCK_IMAGE_ALLOWED_HOSTS = "images.example.test";
  const deps = {
    resolve: async () => [{ address: "8.8.8.8" }],
    request: async () =>
      new Response(new Uint8Array([255, 216, 255]), {
        headers: { "Content-Type": "image/jpeg" },
      }),
  };
  await assert.rejects(
    verifyImage(
      "https://images.example.test/a?Signature=test&Expires=1",
      undefined,
      deps,
    ),
  );
  await assert.rejects(
    verifyImage(
      "https://images.example.test/a?Signature=test",
      undefined,
      deps,
    ),
  );
  await verifyImage(
    `https://images.example.test/a?Signature=test&Expires=${Math.floor(Date.now() / 1000) + 3600}`,
    undefined,
    deps,
  );
  delete process.env.STOCK_IMAGE_ALLOWED_HOSTS;
});
