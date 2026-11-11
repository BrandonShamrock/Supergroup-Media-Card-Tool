import { db, authorize, readInput } from "./lib/core.js";
import { logStock, runStockRefresh } from "./lib/stock-refresh.js";

// Netlify's -background suffix selects asynchronous execution (15-minute platform ceiling).
// The event/202 response is tiny. The upstream feed never crosses the function response boundary.
export default async function handler(request) {
  try {
    const client = db(),
      user = await authorize(request, client);
    if (request.method !== "POST") return new Response(null, { status: 204 });
    const body = await readInput(request);
    if (
      typeof body.job_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.job_id,
      )
    )
      return new Response(null, { status: 204 });
    await runStockRefresh({ client, jobId: body.job_id, userId: user.id });
  } catch {
    logStock("rejected", { code: "BACKGROUND_AUTH_OR_START_FAILURE" });
  }
  return new Response(null, { status: 204 });
}
