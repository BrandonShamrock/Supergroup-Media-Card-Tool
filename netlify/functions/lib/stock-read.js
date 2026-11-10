import { checked, inputError } from "./core.js";
export const MAX_STOCK_PAGE_BYTES = 1024 * 1024;
export async function stockPage(client, cursor) {
  if (cursor && cursor.length > 512) throw inputError("Invalid stock cursor.");
  let query = client
    .from("vehicle_stock")
    .select("*")
    .order("source_id")
    .limit(200);
  if (cursor) query = query.gt("source_id", cursor);
  const fetched = await checked(query);
  let rows = [...fetched];
  const page = () => ({
    vehicles: rows,
    next_cursor:
      rows.length && (rows.length < fetched.length || fetched.length === 200)
        ? rows.at(-1).source_id
        : null,
  });
  while (
    Buffer.byteLength(JSON.stringify(page())) > MAX_STOCK_PAGE_BYTES &&
    rows.length > 1
  )
    rows = rows.slice(0, Math.ceil(rows.length / 2));
  if (Buffer.byteLength(JSON.stringify(page())) > MAX_STOCK_PAGE_BYTES)
    throw inputError(
      "A normalized stock record exceeds the safe response size.",
    );
  return page();
}
