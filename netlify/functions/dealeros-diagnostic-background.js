import { db, authorize, readInput } from "./lib/core.js";
import {
  logConnectivity,
  runConnectivityDiagnostic,
} from "./lib/connectivity.js";
export function createDiagnosticHandler({
  makeClient = db,
  checkAuth = authorize,
  run = runConnectivityDiagnostic,
  logger = console.info,
} = {}) {
  return async (request) => {
    try {
      const client = makeClient(),
        user = await checkAuth(request, client);
      if (request.method !== "POST") return new Response(null, { status: 204 });
      const body = await readInput(request);
      if (
        typeof body.diagnostic_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          body.diagnostic_id,
        )
      )
        return new Response(null, { status: 204 });
      const { data, error } = await client.rpc("claim_dealeros_diagnostic", {
        p_id: body.diagnostic_id,
        p_user: user.id,
      });
      if (error || !data) {
        logConnectivity(
          {
            event: "ignored",
            diagnostic_id: body.diagnostic_id,
            code: "DIAGNOSTIC_NOT_CLAIMED",
          },
          logger,
        );
        return new Response(null, { status: 204 });
      }
      await run({ id: body.diagnostic_id, logger });
    } catch {
      logConnectivity(
        { event: "rejected", code: "DIAGNOSTIC_AUTH_OR_START_FAILURE" },
        logger,
      );
    }
    return new Response(null, { status: 204 });
  };
}
export default createDiagnosticHandler();
