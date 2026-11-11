import { supabase } from "./supabase";
export async function api(action, body) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Please sign in again.");
  const response = await fetch(`/.netlify/functions/api?action=${action}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "Backend unavailable. Use Netlify Dev or a configured Netlify deployment.",
    );
  }
  if (!response.ok)
    throw new Error(
      [result.code, result.error || "Request failed."]
        .filter(Boolean)
        .join(": "),
    );
  if (action === "dashboard" && result.stock_paginated) {
    const vehicles = [];
    let cursor = null;
    do {
      const page = await api(
        "stock-page" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      );
      vehicles.push(...page.vehicles);
      if (page.next_cursor && page.next_cursor === cursor)
        throw new Error("Stock pagination did not advance. Retry refresh.");
      cursor = page.next_cursor;
    } while (cursor);
    result.vehicles = vehicles;
  }
  return result;
}
