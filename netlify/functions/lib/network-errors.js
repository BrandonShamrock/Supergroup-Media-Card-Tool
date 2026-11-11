// Never serialize Error objects: message, stack, address and nested request data may contain secrets.
const DNS = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "ENODATA"]);
const TLS = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE",
  "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
  "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
]);
const TIMEOUT = new Set([
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
]);
const TCP = new Set([
  "EADDRNOTAVAIL",
  "EACCES",
  "EPERM",
  "ENETRESET",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "EPIPE",
  "UND_ERR_SOCKET",
]);
const HTTP = new Set([
  "UND_ERR_RESPONSE_STATUS_CODE",
  "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
]);
const REQUEST_CONFIG = new Set([
  "ERR_INVALID_CHAR",
  "ERR_HTTP_INVALID_HEADER_VALUE",
  "ERR_INVALID_HTTP_TOKEN",
  "ERR_INVALID_ARG_TYPE",
  "ERR_INVALID_ARG_VALUE",
]);
const known = new Set([
  ...DNS,
  ...TLS,
  ...TIMEOUT,
  ...TCP,
  ...HTTP,
  ...REQUEST_CONFIG,
]);
const names = new Set([
  "Error",
  "TypeError",
  "AggregateError",
  "AbortError",
  "TimeoutError",
  "SystemError",
]);
export function networkErrorDetails(error, { timedOut = false } = {}) {
  const codes = [],
    seen = new Set();
  const visit = (value, depth) => {
    if (
      !value ||
      typeof value !== "object" ||
      seen.has(value) ||
      depth > 4 ||
      seen.size >= 16
    )
      return;
    seen.add(value);
    if (known.has(value.code) && !codes.includes(value.code))
      codes.push(value.code);
    visit(value.cause, depth + 1);
    if (Array.isArray(value.errors))
      for (const item of value.errors.slice(0, 8)) visit(item, depth + 1);
  };
  visit(error, 0);
  const classes = [
    ...new Set(
      codes.map((code) =>
        DNS.has(code)
          ? "DNS"
          : TLS.has(code)
            ? "TLS"
            : TIMEOUT.has(code)
              ? "TIMEOUT"
              : TCP.has(code)
                ? "TCP"
                : REQUEST_CONFIG.has(code)
                  ? "REQUEST_CONFIG"
                  : "HTTP_PROTOCOL",
      ),
    ),
  ];
  if (timedOut && !classes.includes("TIMEOUT")) classes.push("TIMEOUT");
  const cause_code = known.has(error?.cause?.code)
    ? error.cause.code
    : codes[0] || "UNKNOWN";
  return {
    error_name: names.has(error?.name) ? error.name : "Error",
    cause_code,
    cause_codes: codes,
    network_class: classes.length > 1 ? "MULTIPLE" : classes[0] || "UNKNOWN",
    network_classes: classes.length ? classes : ["UNKNOWN"],
  };
}
export function redirectDetails(response, origin) {
  let same = false,
    scheme = "invalid";
  try {
    const location = response.headers.get("location");
    if (!location) throw new Error();
    const target = new URL(location, origin);
    same = target.origin === new URL(origin).origin;
    scheme =
      target.protocol === "https:"
        ? "https"
        : target.protocol === "http:"
          ? "http"
          : "other";
  } catch {}
  return { redirect_same_origin: same, redirect_scheme: scheme };
}
