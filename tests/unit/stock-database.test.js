import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseStock } from "../../shared/domain.js";
const user = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const job = "33333333-3333-4333-8333-333333333333",
  retry = "44444444-4444-4444-8444-444444444444",
  third = "55555555-5555-4555-8555-555555555555";
test("background migration preserves transactional safeguards, single claims and terminal job status", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;insert into auth.users values('${user}'),('${other}');`,
    );
    for (const file of [
      "202611100001_integration.sql",
      "202611100002_dealership_seed.sql",
      "202611110001_background_stock_refresh.sql",
    ])
      await db.exec(
        await readFile(
          new URL("../../supabase/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
    await db.query("insert into authorized_users values($1),($2)", [
      user,
      other,
    ]);
    const request = async (id, who = user) =>
      (await db.query("select request_stock_sync($1,$2) s", [id, who])).rows[0]
        .s;
    const claim = async (id, who = user) =>
      (await db.query("select claim_stock_sync($1,$2) s", [id, who])).rows[0].s;
    const status = async () =>
      (await db.query("select stock_sync_status() s")).rows[0].s;
    const rows = parseStock(
      [1, 2, 3, 4].map((id) => ({
        id,
        stock_id: "S" + id,
        dealership_id: "10",
        dealership_name: "Dealer",
        make: "Toyota",
        model: "Test",
        year: 2024,
        mileage: 1000,
        retail_price: 10000,
        listingImages: [{ order: 1, url: "https://images.example.test/a.jpg" }],
      })),
    ).vehicles;
    assert.equal((await request(job)).job_id, job);
    assert.equal(await claim(job, other), null);
    assert.ok(await claim(job));
    assert.equal(await claim(job), null);
    await db.query("select apply_stock_sync($1,'stock_id',$2::jsonb)", [
      job,
      JSON.stringify(rows),
    ]);
    const successful = await status();
    assert.equal(successful.status, "succeeded");
    assert.equal(successful.vehicle_count, 4);
    assert.ok(successful.last_success_at);
    assert.equal(successful.job_id, job);
    const staleFailure = await db.query(
      "update stock_sync set status='failed' where lease=$1 returning id",
      [job],
    );
    assert.equal(staleFailure.rows.length, 0);
    assert.equal((await status()).status, "succeeded");
    assert.equal((await request(retry)).job_id, retry);
    assert.equal((await request(third)).job_id, retry);
    assert.equal((await request(third, other)).dispatch, false);
    await claim(retry);
    for (const input of [[], rows.slice(0, 1), [...rows.slice(0, 3), rows[0]]])
      await assert.rejects(
        db.query("select apply_stock_sync($1,'stock_id',$2::jsonb)", [
          retry,
          JSON.stringify(input),
        ]),
      );
    assert.equal(
      (await db.query("select count(*)::int n from vehicle_stock")).rows[0].n,
      4,
    );
    assert.equal((await status()).last_success_at, successful.last_success_at);
    await db.exec(
      "update stock_sync set lease_until=now()-interval '1 second'",
    );
    const expired = await status();
    assert.equal(expired.status, "failed");
    assert.equal(expired.error_code, "WORKER_INTERRUPTED");
    await request(third);
    await db.exec("update stock_sync set queued_at=now()-interval '3 minutes'");
    assert.equal((await status()).error_code, "DISPATCH_TIMEOUT");
    assert.equal(await claim(third), null);
    await request(job);
    assert.equal((await status()).status, "queued");
    await assert.rejects(
      db.query("select apply_stock_sync($1,'stock_id',$2::jsonb)", [
        retry,
        JSON.stringify(rows),
      ]),
    );
    assert.equal((await status()).job_id, job);
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}'`);
    await assert.rejects(
      db.query("select request_stock_sync($1,$2)", [third, user]),
    );
    await assert.rejects(db.query("select stock_sync_status()"));
  } finally {
    await db.close();
  }
});
