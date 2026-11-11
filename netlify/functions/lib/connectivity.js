import { lookup, getDefaultResultOrder } from "node:dns";
import { promisify } from "node:util";
import { connect } from "node:tls";
import { getDefaultAutoSelectFamily } from "node:net";
import { DEALEROS_URL } from "./dealeros.js";
import { networkErrorDetails, redirectDetails } from "./network-errors.js";
const HOST = new URL(DEALEROS_URL).hostname;
const resolve = promisify(lookup);
export const DIAGNOSTIC_HTTP_TIMEOUT_MS = 60_000;

export async function lookupDealeros({
  resolver = resolve,
  timeoutMs = 5000,
} = {}) {
  let timer;
  try {
    return await Promise.race([
      resolver(HOST, { all: true }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error(), { code: "ETIMEDOUT" })),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function tlsProbe(
  address,
  { connectSocket = connect, timeoutMs = 5000 } = {},
) {
  return new Promise((resolve) => {
    let connected = false,
      done = false,
      socket,
      timer;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve({ ...result, tcp_connected: connected });
    };
    try {
      socket = connectSocket({
        host: address.address,
        family: address.family,
        port: 443,
        servername: HOST,
        rejectUnauthorized: true,
        ALPNProtocols: ["http/1.1"],
      });
      socket.once("connect", () => {
        connected = true;
      });
      socket.once("secureConnect", () => {
        if (!socket.authorized)
          return finish({
            ok: false,
            ...networkErrorDetails({
              cause: { code: socket.authorizationError },
            }),
          });
        const protocol = socket.getProtocol();
        finish({
          ok: true,
          tls_protocol: ["TLSv1.2", "TLSv1.3"].includes(protocol)
            ? protocol
            : "other",
        });
      });
      socket.once("error", (error) =>
        finish({ ok: false, ...networkErrorDetails(error) }),
      );
      timer = setTimeout(
        () =>
          finish({ ok: false, ...networkErrorDetails({ code: "ETIMEDOUT" }) }),
        timeoutMs,
      );
    } catch (error) {
      finish({ ok: false, ...networkErrorDetails(error) });
    }
  });
}
export async function httpProbe({
  request = fetch,
  token = process.env.STOCK_API_BEARER_TOKEN,
  signal = AbortSignal.timeout(DIAGNOSTIC_HTTP_TIMEOUT_MS),
} = {}) {
  if (!token)
    return { ok: false, network_class: "CONFIG", code: "STOCK_CONFIG" };
  try {
    const response = await request(DEALEROS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
      signal,
    });
    // Do not read JSON, text, arrayBuffer, a body chunk, or log Location/headers.
    await response.body?.cancel().catch(() => {});
    const redirect = response.status >= 300 && response.status < 400;
    return {
      ok: response.ok,
      http_status: response.status,
      body_consumed: false,
      network_class: redirect
        ? "REDIRECT"
        : response.ok
          ? "HTTP_OK"
          : "HTTP_REJECTION",
      ...(redirect ? redirectDetails(response, DEALEROS_URL) : {}),
    };
  } catch (error) {
    return {
      ok: false,
      body_consumed: false,
      ...networkErrorDetails(error, { timedOut: signal.aborted }),
    };
  }
}
export function runtimeSummary(env = process.env) {
  return {
    node_version: process.versions.node,
    dns_order: getDefaultResultOrder(),
    auto_select_family: getDefaultAutoSelectFamily(),
    http_proxy_present: !!(env.HTTP_PROXY || env.http_proxy),
    https_proxy_present: !!(env.HTTPS_PROXY || env.https_proxy),
    all_proxy_present: !!(env.ALL_PROXY || env.all_proxy),
    no_proxy_present: !!(env.NO_PROXY || env.no_proxy),
    env_proxy_enabled:
      env.NODE_USE_ENV_PROXY === "1" ||
      /(?:^|\s)--use-env-proxy(?:\s|$)/.test(env.NODE_OPTIONS || ""),
    custom_ca_present: !!env.NODE_EXTRA_CA_CERTS,
    tls_verification_disabled: env.NODE_TLS_REJECT_UNAUTHORIZED === "0",
  };
}
const fields = [
  "event",
  "diagnostic_id",
  "phase",
  "at",
  "elapsed_ms",
  "ok",
  "family",
  "ipv4_count",
  "ipv6_count",
  "tcp_connected",
  "tls_protocol",
  "http_status",
  "body_consumed",
  "code",
  "error_name",
  "cause_code",
  "cause_codes",
  "network_class",
  "network_classes",
  "redirect_same_origin",
  "redirect_scheme",
  "node_version",
  "dns_order",
  "auto_select_family",
  "http_proxy_present",
  "https_proxy_present",
  "all_proxy_present",
  "no_proxy_present",
  "env_proxy_enabled",
  "custom_ca_present",
  "tls_verification_disabled",
];
export function logConnectivity(data, logger = console.info) {
  logger(
    JSON.stringify({
      component: "dealeros-connectivity",
      ...Object.fromEntries(
        fields.filter((k) => data[k] !== undefined).map((k) => [k, data[k]]),
      ),
    }),
  );
}
export async function runConnectivityDiagnostic({
  id,
  logger = console.info,
  lookupAddresses = lookupDealeros,
  probeTls = tlsProbe,
  probeHttp = httpProbe,
  summary = runtimeSummary,
  now = Date.now,
} = {}) {
  const start = now();
  const emit = (data) =>
    logConnectivity(
      {
        diagnostic_id: id,
        at: new Date(now()).toISOString(),
        elapsed_ms: now() - start,
        ...data,
      },
      logger,
    );
  const runtime = summary();
  emit({ event: "started", phase: "runtime", ...runtime });
  if (runtime.tls_verification_disabled) {
    emit({
      event: "failed",
      phase: "runtime",
      code: "RUNTIME_TLS_UNSAFE",
      network_class: "TLS",
    });
    return;
  }
  let addresses = [];
  try {
    addresses = await lookupAddresses();
    emit({
      event: "result",
      phase: "dns",
      ok: true,
      ipv4_count: addresses.filter((a) => a.family === 4).length,
      ipv6_count: addresses.filter((a) => a.family === 6).length,
    });
  } catch (error) {
    emit({
      event: "result",
      phase: "dns",
      ok: false,
      ...networkErrorDetails(error),
    });
  }
  // At most one direct TLS handshake per address family. Do not send credentials on these probes.
  await Promise.all(
    [4, 6].map(async (family) => {
      const address = addresses.find((a) => a.family === family);
      if (!address) {
        emit({
          event: "skipped",
          phase: "tcp_tls",
          family,
          code: "NO_ADDRESS",
        });
        return;
      }
      emit({
        event: "result",
        phase: "tcp_tls",
        family,
        ...(await probeTls(address)),
      });
    }),
  );
  emit({ event: "result", phase: "http", ...(await probeHttp()) });
  emit({ event: "completed", phase: "complete" });
}
