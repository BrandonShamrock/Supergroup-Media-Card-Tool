import { test, expect } from "@playwright/test";

const dealership = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Test dealership",
  dealeros_id: "10",
  postx_group_id: 123,
  template_name: "test_template",
  card_count: 2,
  active: true,
  mapping_verified: true,
  template_verified: true,
  variable_mapping: {
    recipient: {},
    card: { car_type: "car_type", year: "year", mileage: "mileage" },
  },
};
const inventory = Array.from({ length: 2 }, (_, i) => ({
  source_id: String(i + 1),
  dealership_id: "10",
  dealership_name: "Test dealership",
  make: "Toyota",
  model: i ? "Corolla" : "Fortuner 2.8 GD-6",
  derivative: "Test",
  year: 2024,
  mileage: 10000,
  retail_price: 200000,
  new_used: "Used",
  stock_number: "T" + i,
  colour: "White",
  primary_image_url: "https://images.example.test/vehicle.jpg",
}));
async function mockBackend(page) {
  await page.route("https://images.example.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>',
    }),
  );
  await page.route("**/.netlify/functions/api?**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "dashboard")
      return route.fulfill({
        json: {
          dealerships: [dealership],
          vehicles: inventory,
          campaigns: [],
          sync: { vehicle_count: 2 },
          sending: { enabled: false, verifiedLimit: 0, batchSize: 0 },
        },
      });
    if (action === "preview")
      return route.fulfill({
        json: {
          vehicle_count: 2,
          recipient_count: 1,
          batch_count: null,
          warnings: ["Live sending is disabled."],
        },
      });
    return route.fulfill({
      status: 400,
      json: { error: "Sending disabled in tests." },
    });
  });
}
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "reviewer@example.test",
  aud: "authenticated",
  role: "authenticated",
};
const token = () => {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })}.test-signature`;
};
async function mockAuth(page, { reject = false, invalidSession = false } = {}) {
  await mockBackend(page);
  await page.route("https://auth.example.test/auth/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/token")) {
      return route.fulfill({
        status: reject ? 400 : 200,
        json: reject
          ? { error: "invalid_grant", msg: "Invalid login credentials" }
          : {
              access_token: token(),
              refresh_token: "test-refresh-only",
              expires_in: 3600,
              token_type: "bearer",
              user,
            },
      });
    }
    if (path.endsWith("/user"))
      return route.fulfill({
        status: invalidSession ? 401 : 200,
        json: invalidSession ? { msg: "Invalid token" } : user,
      });
    return route.fulfill({ status: 204, body: "" });
  });
}
async function login(page) {
  await page.getByLabel("Email address").fill(user.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("invented-test-password");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
}
test("requires sign-in, restores a verified session, preserves mock workflow and signs out", async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto("/some/spa/path");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.getByText("Explore demo workspace")).toHaveCount(0);
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Your next campaign starts here." }),
  ).toBeVisible();
  await expect(page.locator(".user-name")).toContainText(user.email);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your next campaign starts here." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Vehicle stock 2", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page
    .getByRole("checkbox", {
      name: "Select Toyota Fortuner 2.8 GD-6",
      exact: true,
    })
    .check();
  await page
    .getByRole("checkbox", { name: "Select Toyota Corolla", exact: true })
    .check();
  await page.getByRole("button", { name: "Preview selection" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Toyota Fortuner 2.8 GD-6",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".sidebar")).toHaveCount(0);
});
test("rejected credentials fail closed with a generic error", async ({
  page,
}) => {
  await mockAuth(page, { reject: true });
  await page.goto("/");
  await login(page);
  await expect(page.getByRole("alert")).toContainText("Unable to sign in");
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
});
test("unverifiable session never mounts dashboard content", async ({
  page,
}) => {
  await mockAuth(page, { invalidSession: true });
  await page.goto("/");
  await login(page);
  await expect(page.getByRole("alert")).toContainText("could not verify");
  await expect(page.locator(".sidebar")).toHaveCount(0);
});
test("sign-out in another tab updates the current tab through auth state changes", async ({
  page,
  context,
}) => {
  await mockAuth(page);
  await page.goto("/");
  await login(page);
  await expect(page.locator(".sidebar")).toBeVisible();
  const other = await context.newPage();
  await mockAuth(other);
  await other.goto("/");
  await expect(other.locator(".sidebar")).toBeVisible();
  await other.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});
test("missing configuration blocks login and dashboard even on a nested path", async ({
  page,
}) => {
  await page.goto("http://localhost:5176/nested/path");
  await expect(page.getByRole("alert")).toContainText(
    "configure the Supabase URL and publishable key",
  );
  await expect(
    page.getByRole("button", { name: "Sign In", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".sidebar")).toHaveCount(0);
});
test("network failure cannot open the dashboard", async ({ page }) => {
  await page.route("https://auth.example.test/**", (route) => route.abort());
  await page.goto("/");
  await login(page);
  await expect(page.getByRole("alert")).toContainText("Unable");
  await expect(page.locator(".sidebar")).toHaveCount(0);
});
test("restored invalid session fails closed after reload", async ({ page }) => {
  await mockAuth(page);
  await page.goto("/");
  await login(page);
  await expect(page.locator(".sidebar")).toBeVisible();
  await mockAuth(page, { invalidSession: true });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("could not verify");
  await expect(page.locator(".sidebar")).toHaveCount(0);
});
test("session verification shows a loading state without dashboard content", async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto("/");
  await login(page);
  await expect(page.locator(".sidebar")).toBeVisible();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/auth/v1/user", async (route) => {
    await pending;
    await route.fulfill({ json: user });
  });
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Checking your session…");
  await expect(page.locator(".sidebar")).toHaveCount(0);
  release();
  await expect(page.locator(".sidebar")).toBeVisible();
});
test("CSV and XLSX import validate audiences and keep live submission disabled", async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto("/");
  await login(page);
  await page
    .getByRole("button", { name: "Client upload", exact: true })
    .click();
  await page.locator("input[type=file]").setInputFiles({
    name: "invented.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Customer name,WhatsApp number\nInvented Customer,0821234567\nDuplicate,+27821234567\n,123",
    ),
  });
  await page.getByRole("button", { name: "Validate recipients" }).click();
  await expect(
    page.getByRole("heading", {
      name: "1 valid · 1 duplicates removed · 1 invalid",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear upload and recipients" })
    .click();
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/customers.xlsx");
  await page.getByRole("button", { name: "Validate recipients" }).click();
  await expect(
    page.getByRole("heading", {
      name: "1 valid · 1 duplicates removed · 1 invalid",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Vehicle stock 2", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Select Toyota Fortuner 2.8 GD-6",
      exact: true,
    })
    .check();
  await page
    .getByRole("checkbox", { name: "Select Toyota Corolla", exact: true })
    .check();
  await page.getByRole("button", { name: "Preview selection" }).click();
  await expect(page.getByText("Live sending is disabled.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm and queue campaign" }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});
test("dealership settings show verified configuration, candidate guidance and editable mappings", async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto("/");
  await login(page);
  await page
    .getByRole("button", { name: "Dealership settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Test dealership", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("PostX group ID", { exact: true })).toHaveValue(
    "123",
  );
  await expect(
    page.getByLabel("Required card count", { exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByLabel("Case-sensitive template variable mappings (JSON)"),
  ).toContainText("car_type");
});

for (const outcome of ["succeeded", "failed", "immediate"])
  test(`background stock refresh polls for ${outcome} rather than treating 202 as success`, async ({
    page,
  }) => {
    await mockAuth(page);
    const id = "33333333-3333-4333-8333-333333333333";
    let status = "idle",
      polls = 0,
      pages = 0;
    const sync = () => ({
      status,
      job_id: id,
      phase: status === "running" ? "fetching" : status,
      vehicle_count: 2,
      ...(status === "failed"
        ? {
            error_code: "UPSTREAM_TIMEOUT",
            error: "DealerOS fetch/download exceeded its time budget.",
          }
        : {}),
    });
    await page.route("**/.netlify/functions/api?**", async (route) => {
      const url = new URL(route.request().url()),
        action = url.searchParams.get("action");
      if (action === "dashboard")
        return route.fulfill({
          json: {
            dealerships: [dealership],
            vehicles: [],
            stock_paginated: true,
            campaigns: [],
            sync: sync(),
            sending: { enabled: false },
          },
        });
      if (action === "stock-page") {
        pages++;
        const cursor = url.searchParams.get("cursor");
        return route.fulfill({
          json: {
            vehicles: cursor ? [inventory[1]] : [inventory[0]],
            next_cursor: cursor ? null : inventory[0].source_id,
          },
        });
      }
      if (action === "refresh") {
        status = "queued";
        return route.fulfill({
          status: 202,
          json: { job_id: id, queued: true },
        });
      }
      if (action === "stock-status") {
        polls++;
        status =
          outcome === "immediate"
            ? "succeeded"
            : polls < 2
              ? "running"
              : outcome;
        return route.fulfill({ json: { sync: sync() } });
      }
      return route.fulfill({
        status: 400,
        json: { error: "Unexpected test operation" },
      });
    });
    await page.goto("/");
    await login(page);
    await page
      .getByRole("button", { name: "Refresh stock", exact: true })
      .click();
    if (outcome !== "immediate") {
      await expect(
        page.getByRole("status").filter({ hasText: "Stock refresh running" }),
      ).toBeVisible();
      await expect(page.getByText(/Stock synchronized:/)).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Refreshing…", exact: true }),
      ).toBeDisabled();
    }
    if (outcome !== "failed")
      await expect(
        page.getByText("Stock synchronized: 2 vehicles. Job " + id + "."),
      ).toBeVisible({ timeout: 10000 });
    else
      await expect(
        page.getByRole("alert").filter({ hasText: "UPSTREAM_TIMEOUT" }).first(),
      ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("button", { name: "Refresh stock", exact: true }),
    ).toBeEnabled();
    expect(pages).toBeGreaterThanOrEqual(outcome !== "failed" ? 4 : 2);
  });
