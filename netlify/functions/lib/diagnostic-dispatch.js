import { randomUUID } from "node:crypto";
import { backgroundOrigin } from "./stock-refresh.js";
import { StockError } from "./dealeros.js";
import { logConnectivity } from "./connectivity.js";
export async function requestConnectivityDiagnostic({
  client,
  user,
  authorization,
  request = fetch,
  logger = console.info,
}) {
  const origin = backgroundOrigin(),
    id = randomUUID();
  const { data, error } = await client.rpc("request_dealeros_diagnostic", {
    p_id: id,
    p_user: user.id,
  });
  if (error)
    throw new StockError(
      "DIAGNOSTIC_DATABASE",
      "Could not queue diagnostic. Check the diagnostic migration.",
    );
  if (!data)
    throw Object.assign(
      new Error("Wait two minutes between connectivity diagnostics."),
      { status: 429 },
    );
  let confirmed = false;
  try {
    const response = await request(
      `${origin}/.netlify/functions/dealeros-diagnostic-background`,
      {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ diagnostic_id: id }),
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      },
    );
    confirmed = response.status === 202;
    await response.body?.cancel().catch(() => {});
  } catch {}
  logConnectivity(
    {
      event: "dispatch",
      diagnostic_id: id,
      code: confirmed ? "BACKGROUND_ACCEPTED" : "DISPATCH_UNCONFIRMED",
    },
    logger,
  );
  return { diagnostic_id: id, dispatch_confirmed: confirmed };
}
