import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseStock } from "../../shared/domain.js";
const uid = "11111111-1111-4111-8111-111111111111";
const cid = "22222222-2222-4222-8222-222222222222";
const lease = "33333333-3333-4333-8333-333333333333";
const uuid2 = "44444444-4444-4444-8444-444444444444";
const db = new PGlite();
const stock = (ids) =>
  parseStock(
    ids.map((id) => ({
      id,
      stock_id: "S" + id,
      dealership_id: "10",
      dealership_name: "Dealer",
      make: "Toyota",
      model: "Test",
      year: 2024,
      mileage: 100,
      retail_price: 10000,
    })),
  ).vehicles;
async function setup() {
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; insert into auth.users values('${uid}');`,
  );
  for (const file of [
    "202611100001_integration.sql",
    "202611100002_dealership_seed.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
}
test("migrations, staging UPSERT/removal, deletion safeguards, leases, RLS, queue idempotency and outcomes", async () => {
  await setup();
  assert.equal(
    (await db.query("select count(*)::int n from dealerships")).rows[0].n,
    57,
  );
  const acquire = () => db.query("select acquire_stock_sync($1)", [lease]);
  const apply = (rows) =>
    db.query("select apply_stock_sync($1,'stock_id',$2::jsonb)", [
      lease,
      JSON.stringify(rows),
    ]);
  await acquire();
  await assert.rejects(acquire());
  await apply(stock([1, 2, 3, 4, 5]));
  await acquire();
  await apply(stock([1, 2, 3, 4, 5]));
  assert.equal(
    (await db.query("select count(*)::int n from vehicle_stock")).rows[0].n,
    5,
  );
  await acquire();
  await assert.rejects(apply([]));
  await assert.rejects(apply(stock([1])));
  assert.equal(
    (await db.query("select count(*)::int n from vehicle_stock")).rows[0].n,
    5,
  );
  await apply(stock([1, 2, 3, 4]));
  assert.equal(
    (await db.query("select count(*)::int n from vehicle_stock")).rows[0].n,
    4,
  );
  assert.equal(
    (await db.query("select count(*)::int n from dealerships")).rows[0].n,
    57,
  );
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${uid}';`);
  assert.equal((await db.query("select * from vehicle_stock")).rows.length, 0);
  await assert.rejects(db.query("select * from campaign_batches"));
  await assert.rejects(db.query("select claim_batch()"));
  await db.exec(
    `reset role; insert into authorized_users values('${uid}'); set role authenticated;`,
  );
  assert.equal((await db.query("select * from vehicle_stock")).rows.length, 4);
  await assert.rejects(db.query("delete from vehicle_stock"));
  await db.exec("reset role;");
  const dealer = (await db.query("select id from dealerships limit 1")).rows[0]
    .id;
  const campaign = {
    id: cid,
    request_fingerprint: "same-campaign",
    created_by: uid,
    dealership_id: dealer,
    name: "Database test",
    config_snapshot: { name: "Dealer" },
    recipient_count: 2,
  };
  const batches = [
    [
      {
        name: "Test One",
        whatsapp_number: "+27821234567",
        external_reference: "ref1",
      },
    ],
    [
      {
        name: "Test Two",
        whatsapp_number: "+27821234568",
        external_reference: "ref2",
      },
    ],
  ];
  const queue = (c) =>
    db.query("select queue_campaign($1::jsonb,$2::jsonb,$3::jsonb) id", [
      JSON.stringify(c),
      JSON.stringify(stock([1, 2])),
      JSON.stringify(batches),
    ]);
  assert.equal((await queue(campaign)).rows[0].id, cid);
  assert.equal((await queue(campaign)).rows[0].id, cid);
  assert.equal((await queue({ ...campaign, id: uuid2 })).rows[0].id, cid);
  assert.equal(
    (await db.query("select count(*)::int n from campaign_batches")).rows[0].n,
    2,
  );
  const first = (await db.query("select claim_batch() b")).rows[0].b;
  assert.equal(first.position, 0);
  const second = (await db.query("select claim_batch() b")).rows[0].b;
  assert.equal(second.position, 1);
  assert.equal((await db.query("select claim_batch() b")).rows[0].b, null);
  await db.query("select finish_batch($1,'completed',$2::jsonb,null)", [
    first.id,
    JSON.stringify([
      {
        external_reference: "ref1",
        status: "accepted",
        conversation_id: "123",
        error: null,
      },
    ]),
  ]);
  await assert.rejects(
    db.query("select finish_batch($1,'completed','[]'::jsonb,null)", [
      first.id,
    ]),
  );
  await db.query(
    "update campaign_batches set started_at=now()-interval '4 minutes' where id=$1",
    [second.id],
  );
  await db.query("select cleanup_campaigns()");
  const final = (await db.query("select * from campaigns where id=$1", [cid]))
    .rows[0];
  assert.equal(final.accepted_count, 1);
  assert.equal(final.unknown_count, 1);
  assert.equal(final.status, "needs_review");
  assert.equal((await db.query("select claim_batch() b")).rows[0].b, null);
  const saved = (
    await db.query("select * from campaign_batches where id=$1", [second.id])
  ).rows[0];
  assert.equal(saved.recipients, null);
  assert.deepEqual(saved.recipient_references, ["ref2"]);
  await db.query("delete from vehicle_stock");
  assert.equal(
    (await db.query("select * from campaign_vehicle_snapshots")).rows.length,
    1,
  );
  await queue({
    ...campaign,
    id: uuid2,
    request_fingerprint: "different-campaign",
  });
  await db.query(
    "update campaigns set created_at=now()-interval '10 days' where id=$1",
    [uuid2],
  );
  await db.query("select cleanup_campaigns()");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from campaign_batches where campaign_id=$1 and recipients is not null",
        [uuid2],
      )
    ).rows[0].n,
    2,
  );
  await db.query("select cancel_campaign($1)", [uuid2]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from campaign_batches where campaign_id=$1 and recipients is not null",
        [uuid2],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query("select failed_count from campaigns where id=$1", [uuid2]))
      .rows[0].failed_count,
    2,
  );
  await db.close();
});
