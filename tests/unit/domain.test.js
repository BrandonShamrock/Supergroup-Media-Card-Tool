import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJSON,
  primaryImage,
  parseStock,
  dealershipCandidates,
  normalizePhone,
  importRecipients,
  validateConfig,
  buildPayload,
  splitBatches,
  summarizeResponse,
} from "../../shared/domain.js";
const row = {
  id: 1,
  stock_id: "S1",
  dealership_id: 10,
  dealership_name: "Dealer One",
  make: "Toyota",
  model: "Corolla",
  year: 2024,
  mileage: 10000,
  retail_price: 200000,
  listingImages: [
    { order: 2, url: "https://images.example.test/two.jpg" },
    { order: 1, url: "https://images.example.test/one.jpg" },
  ],
};
const config = {
  active: true,
  mapping_verified: true,
  template_verified: true,
  dealeros_id: "10",
  name: "Dealer One",
  postx_group_id: 123,
  template_name: "approved_carousel",
  card_count: 2,
  variable_mapping: {
    recipient: { client_interest: "literal:Toyota" },
    card: { car_type: "car_type", year: "year", mileage: "mileage" },
  },
};
const stock = () =>
  parseStock([row, { ...row, id: 2, stock_id: "S2" }]).vehicles;
const recipients = [{ name: "Example", whatsapp_number: "+27821234567" }];
test("stock validates completeness and stable uniqueness; only order-1 image retained", () => {
  const parsed = parseStock([row]);
  assert.equal(parsed.strategy, "stock_id");
  assert.equal(
    parsed.vehicles[0].primary_image_url,
    "https://images.example.test/one.jpg",
  );
  assert.equal(primaryImage([{ order: 2, url: "https://example.test" }]), null);
  assert.equal(primaryImage([{ order: 1, url: "http://example.test" }]), null);
  assert.equal(parseStock([row, { ...row, id: 2 }]).strategy, "id");
  assert.throws(() => parseStock([row, { ...row, id: 2 }], "stock_id"));
  for (const value of [
    [],
    {},
    { data: [row], total: 10 },
    { data: [row], links: { next: "page2" } },
    [{ ...row, mileage: null }],
    [{ ...row, dealership_name: "" }],
  ])
    assert.throws(() => parseStock(value));
});
test("dealership matching yields candidates only, retains ambiguous IDs", () => {
  const rows = [
    { dealership_id: "1", dealership_name: "Dealer One" },
    { dealership_id: "2", dealership_name: "Dealer-One" },
  ];
  assert.equal(dealershipCandidates("dealer one", rows).length, 2);
  assert.equal(dealershipCandidates("Other", rows).length, 0);
});
test("phones normalize ZA and international values without inventing missing numbers", () => {
  assert.equal(normalizePhone("082 123 4567"), "+27821234567");
  assert.equal(normalizePhone("27821234567"), "+27821234567");
  assert.equal(normalizePhone("00442079460018"), "+442079460018");
  assert.equal(normalizePhone("+1 (415) 555-2671"), "+14155552671");
  for (const raw of ["", null, "123", "bad", "+0000123", "0821234567 ext 1"])
    assert.equal(normalizePhone(raw), null);
});
test("spreadsheet mapping validates names, reports invalid rows, removes normalized duplicates", () => {
  const result = importRecipients(
    [
      ["Example", "0821234567"],
      ["Other", "+27821234567"],
      ["", "+442079460018"],
      ["UK", "+442079460018"],
    ],
    0,
    1,
  );
  assert.equal(result.recipients.length, 2);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.invalid, [
    { row: 4, reason: "Missing or invalid name" },
  ]);
  assert.throws(() => importRecipients([], 0, 0));
});
test("payload uses ordered cards, exact case-sensitive variables and unique references", () => {
  const payload = buildPayload(config, stock().reverse(), recipients, "cid");
  assert.equal(payload.group_id, 123);
  assert.equal(payload.recipients[0].variables.client_interest, "Toyota");
  assert.equal(payload.carousel[0].variables.year, "2024");
  assert.equal(payload.carousel.length, 2);
  assert.equal(payload.recipients[0].external_reference, "cid-0");
  assert.throws(() =>
    buildPayload(config, stock().slice(0, 1), recipients, "x"),
  );
  assert.throws(() =>
    buildPayload(
      config,
      [...stock().slice(0, 1), { ...stock()[1], primary_image_url: null }],
      recipients,
      "x",
    ),
  );
  assert.throws(() => validateConfig({ ...config, mapping_verified: false }));
  assert.throws(() => validateConfig({ ...config, template_verified: false }));
  assert.throws(() =>
    validateConfig({
      ...config,
      variable_mapping: { recipient: { foo: "phone" }, card: {} },
    }),
  );
});
test("batch limit must be explicitly verified and cannot exceed 500", () => {
  assert.deepEqual(splitBatches([1, 2, 3, 4, 5], 2, 2), [[1, 2], [3, 4], [5]]);
  for (const [size, limit] of [
    [1, 0],
    [501, 501],
    [10, 5],
    [0, 500],
  ])
    assert.throws(() => splitBatches([1], size, limit));
});
test("PostX outcomes correlate references; missing outcomes are unknown, never delivered", () => {
  const submitted = [{ external_reference: "a" }, { external_reference: "b" }];
  assert.deepEqual(
    summarizeResponse(
      {
        recipients: [
          { external_reference: "a", status: "accepted", conversation_id: 123 },
        ],
      },
      submitted,
    ).map((r) => r.status),
    ["accepted", "unknown"],
  );
  assert.throws(() =>
    summarizeResponse(
      { recipients: [{ external_reference: "wrong" }] },
      submitted,
    ),
  );
  assert.throws(() =>
    summarizeResponse(
      {
        recipients: [{ external_reference: "a" }, { external_reference: "a" }],
      },
      submitted,
    ),
  );
});

test("configuration comparisons are independent of JSONB object key order", () => {
  assert.equal(
    canonicalJSON({ b: { y: 2, x: 1 }, a: 3 }),
    canonicalJSON({ a: 3, b: { x: 1, y: 2 } }),
  );
  assert.notEqual(canonicalJSON([1, 2]), canonicalJSON([2, 1]));
});
