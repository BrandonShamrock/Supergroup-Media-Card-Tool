import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  networkErrorDetails,
  redirectDetails,
} from "../../netlify/functions/lib/network-errors.js";
import {
  httpProbe,
  tlsProbe,
  lookupDealeros,
  runConnectivityDiagnostic,
  runtimeSummary,
  logConnectivity,
} from "../../netlify/functions/lib/connectivity.js";
import { feed, DEALEROS_URL } from "../../netlify/functions/lib/dealeros.js";
import { createDiagnosticHandler } from "../../netlify/functions/dealeros-diagnostic-background.js";
const id = "11111111-1111-4111-8111-111111111111";
test("Node cause classification handles DNS, certificates, resets, aggregate family errors and timeouts safely", () => {
  for (const [code, kind] of [
    ["ENOTFOUND", "DNS"],
    ["EAI_AGAIN", "DNS"],
    ["CERT_HAS_EXPIRED", "TLS"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "TLS"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "TLS"],
    ["ENETUNREACH", "TCP"],
    ["ECONNRESET", "TCP"],
    ["UND_ERR_CONNECT_TIMEOUT", "TIMEOUT"],
  ]) {
    const error = new TypeError(
      "Bearer secret https://signed.example.test/?signature=secret",
      {
        cause: Object.assign(new Error("secret"), {
          code,
          address: "private-address",
        }),
      },
    );
    const result = networkErrorDetails(error);
    assert.equal(result.network_class, kind);
    assert.equal(result.cause_code, code);
    assert.equal(result.error_name, "TypeError");
    assert.ok(!JSON.stringify(result).includes("secret"));
  }
  const aggregate = new TypeError("fetch failed", {
    cause: new AggregateError([
      Object.assign(new Error(), { code: "ENETUNREACH" }),
      Object.assign(new Error(), { code: "ETIMEDOUT" }),
    ]),
  });
  assert.deepEqual(networkErrorDetails(aggregate).cause_codes, [
    "ENETUNREACH",
    "ETIMEDOUT",
  ]);
  assert.equal(networkErrorDetails(aggregate).network_class, "MULTIPLE");
  assert.equal(
    networkErrorDetails({ code: "secret-token" }).cause_code,
    "UNKNOWN",
  );
  const cycle = {};
  cycle.cause = cycle;
  assert.equal(networkErrorDetails(cycle).network_class, "UNKNOWN");
});
test("stock fetch rejects observable redirects without following or forwarding credentials", async () => {
  let calls = 0,
    options;
  await assert.rejects(
    feed(undefined, null, {
      token: "invented-secret",
      request: async (_url, opts) => {
        calls++;
        options = opts;
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://other.example.test/private?token=secret",
          },
        });
      },
    }),
    (e) => {
      assert.equal(e.code, "UPSTREAM_REDIRECT");
      assert.equal(e.details.http_status, 302);
      assert.equal(e.details.redirect_same_origin, false);
      assert.ok(!JSON.stringify(e.details).includes("secret"));
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.equal(options.redirect, "manual");
  assert.equal(
    redirectDetails(new Response(null, { status: 302 }), DEALEROS_URL)
      .redirect_scheme,
    "invalid",
  );
});
test("stock errors now propagate whitelisted cause codes without error objects", async () => {
  await assert.rejects(
    feed(undefined, null, {
      token: "invented",
      request: async () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("secret"), {
            code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          }),
        });
      },
    }),
    (e) =>
      e.code === "UPSTREAM_TLS" &&
      e.details.cause_code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  );
});
test("HTTP diagnostic GET inspects headers and cancels without consuming or following the body", async () => {
  let cancelled = false,
    called = 0;
  const stream = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const result = await httpProbe({
    token: "invented",
    request: async (url, opts) => {
      called++;
      assert.equal(url, DEALEROS_URL);
      assert.equal(opts.method, "GET");
      assert.equal(opts.redirect, "manual");
      return new Response(stream, {
        status: 307,
        headers: { location: "/private?signature=secret" },
      });
    },
  });
  assert.equal(called, 1);
  assert.equal(cancelled, true);
  assert.equal(result.body_consumed, false);
  assert.equal(result.network_class, "REDIRECT");
  assert.equal(result.redirect_same_origin, true);
  assert.ok(!JSON.stringify(result).includes("signature"));
  assert.equal(
    (
      await httpProbe({
        token: "invented",
        request: async () => new Response(null, { status: 403 }),
      })
    ).network_class,
    "HTTP_REJECTION",
  );
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (
      await httpProbe({
        token: "invented",
        signal: controller.signal,
        request: async () => {
          throw new Error("secret");
        },
      })
    ).network_class,
    "TIMEOUT",
  );
});
test("TLS probe retains hostname verification, SNI and reports v4/v6 TCP failures", async () => {
  let destroyed = false;
  const socket = () => {
    const s = new EventEmitter();
    s.destroy = () => {
      destroyed = true;
    };
    s.authorized = true;
    s.getProtocol = () => "TLSv1.3";
    return s;
  };
  const good = await tlsProbe(
    { address: "192.0.2.1", family: 4 },
    {
      connectSocket: (opts) => {
        assert.equal(opts.rejectUnauthorized, true);
        assert.equal(opts.servername, "api.dealeros.co.za");
        assert.equal(opts.family, 4);
        const s = socket();
        queueMicrotask(() => {
          s.emit("connect");
          s.emit("secureConnect");
        });
        return s;
      },
    },
  );
  assert.equal(good.ok, true);
  assert.equal(good.tcp_connected, true);
  assert.equal(destroyed, true);
  const bad = await tlsProbe(
    { address: "2001:db8::1", family: 6 },
    {
      connectSocket: () => {
        const s = socket();
        queueMicrotask(() =>
          s.emit(
            "error",
            Object.assign(new Error("secret address"), { code: "ENETUNREACH" }),
          ),
        );
        return s;
      },
    },
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.cause_code, "ENETUNREACH");
  assert.equal(bad.tcp_connected, false);
});
test("DNS diagnostic timeout is bounded", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = lookupDealeros({
    resolver: () => new Promise(() => {}),
    timeoutMs: 5000,
  });
  t.mock.timers.tick(5000);
  await assert.rejects(pending, (e) => e.code === "ETIMEDOUT");
});
test("diagnostic logs runtime flags and per-family results but no credentials, proxy URLs or resolved addresses", async () => {
  const logs = [];
  const proxy = "https://user:secret@proxy.example.test/private";
  await runConnectivityDiagnostic({
    id,
    logger: (s) => logs.push(s),
    summary: () =>
      runtimeSummary({
        HTTPS_PROXY: proxy,
        NODE_EXTRA_CA_CERTS: "/private/certificate-path",
      }),
    lookupAddresses: async () => [
      { address: "192.0.2.1", family: 4 },
      { address: "2001:db8::1", family: 6 },
    ],
    probeTls: async (a) =>
      a.family === 4
        ? { ok: true, tcp_connected: true, tls_protocol: "TLSv1.3" }
        : {
            ok: false,
            tcp_connected: false,
            ...networkErrorDetails({ code: "ENETUNREACH" }),
          },
    probeHttp: async () => ({
      ok: false,
      http_status: 403,
      body_consumed: false,
      network_class: "HTTP_REJECTION",
    }),
  });
  const results = logs.map((s) => JSON.parse(s));
  assert.ok(
    results.some((r) => r.family === 6 && r.cause_code === "ENETUNREACH"),
  );
  assert.ok(results.some((r) => r.phase === "http" && r.http_status === 403));
  assert.equal(results[0].https_proxy_present, true);
  assert.ok(
    logs.every(
      (s) =>
        !s.includes("secret") &&
        !s.includes("192.0.2.1") &&
        !s.includes("2001:db8") &&
        !s.includes("/private"),
    ),
  );
  logConnectivity(
    {
      event: "test",
      url: proxy,
      headers: { authorization: "secret" },
      error: new Error("secret"),
    },
    (s) => assert.ok(!s.includes("secret")),
  );
});
test("diagnostic does not send credentials when environment disables TLS validation", async () => {
  let called = false;
  const logs = [];
  await runConnectivityDiagnostic({
    id,
    logger: (s) => logs.push(s),
    summary: () => ({ tls_verification_disabled: true }),
    probeHttp: async () => {
      called = true;
    },
  });
  assert.equal(called, false);
  assert.ok(logs.some((s) => s.includes("RUNTIME_TLS_UNSAFE")));
});
test("background diagnostic requires application authorization and a single claimed diagnostic", async () => {
  let ran = 0,
    rpcCalls = 0;
  const request = () =>
    new Request(
      "https://test.netlify.app/.netlify/functions/dealeros-diagnostic-background",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diagnostic_id: id }),
      },
    );
  const client = {
    rpc: async () => {
      rpcCalls++;
      return { data: rpcCalls === 1, error: null };
    },
  };
  const denied = createDiagnosticHandler({
    makeClient: () => client,
    checkAuth: async () => {
      throw new Error("secret token");
    },
    run: async () => {
      ran++;
    },
    logger: () => {},
  });
  await denied(request());
  assert.equal(ran, 0);
  assert.equal(rpcCalls, 0);
  const allowed = createDiagnosticHandler({
    makeClient: () => client,
    checkAuth: async () => ({ id: "user" }),
    run: async () => {
      ran++;
    },
    logger: () => {},
  });
  await allowed(request());
  await allowed(request());
  assert.equal(ran, 1);
});
