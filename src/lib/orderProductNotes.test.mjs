import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildMatchedOrderRows,
  buildOrderRemarks,
  mergeFallbackProductNotes,
  normalizeProductNote,
  resolveDisplayRemark,
  verifyOrderProductNotesPersistence,
} from "./orderProductNotes.mjs";

const addOrderPagePath = new URL("../app/dashboard/dealer/AddOrderForm/page.tsx", import.meta.url);
const draftsPath = new URL("./drafts.ts", import.meta.url);
const orderDetailPagePath = new URL("../app/orders/[id]/page.tsx", import.meta.url);

test("Product note is included in line remarks before the order note", () => {
  assert.equal(
    buildOrderRemarks("Cat. No: 50/8 | Priority delivery", "Urgent dispatch", "Pack separately"),
    "Cat. No: 50/8 | Priority delivery | Product note: Pack separately | Order note: Urgent dispatch"
  );
});

test("Notes longer than 500 characters are truncated at the helper boundary", () => {
  const note = "x".repeat(700);
  assert.equal(normalizeProductNote(note).length, 500);
});

test("PHP remarks that already contain the product note do not trigger fallback writes", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });

    if (String(url).includes("/orderdatalist")) {
      return {
        ok: true,
        async json() {
          return {
            data: [
              {
                orderdata_id: "101",
                orderdata_orderid: "901",
                orderdata_cat_no: "50/8",
                remark: "Cat. No: 50/8 | Product note: Pack separately",
              },
            ],
          };
        },
      };
    }

    throw new Error("Fallback POST should not be called");
  };

  const summary = await verifyOrderProductNotesPersistence({
    fetchImpl,
    backendUrl: "https://example.test/api",
    actualOrderId: "901",
    dealerId: "44",
    submittedRows: [{ variantCode: "50/8", productNote: "Pack separately" }],
  });

  assert.deepEqual(summary, { verifiedInPhp: 1, savedToFallback: 0, failed: 0 });
  assert.equal(calls.length, 1);
});

test("Missing PHP product notes fall back only after the actual order ID is known", async () => {
  const posts = [];
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes("/orderdatalist")) {
      return {
        ok: true,
        async json() {
          return {
            data: [
              {
                orderdata_id: "555",
                orderdata_orderid: "902",
                orderdata_cat_no: "50/8",
                remark: "Cat. No: 50/8 | Priority delivery",
              },
            ],
          };
        },
      };
    }

    posts.push(JSON.parse(String(init.body)));
    return { ok: true, async json() { return { success: true }; } };
  };

  const summary = await verifyOrderProductNotesPersistence({
    fetchImpl,
    backendUrl: "https://example.test/api",
    actualOrderId: "902",
    dealerId: "44",
    submittedRows: [{ variantCode: "50/8", productNote: "Pack separately" }],
  });

  assert.deepEqual(summary, { verifiedInPhp: 0, savedToFallback: 1, failed: 0 });
  assert.equal(posts[0].orderId, "902");
  assert.equal(posts[0].orderItemId, "555");
});

test("Predicted order numbers are rejected as fallback storage keys", async () => {
  await assert.rejects(
    verifyOrderProductNotesPersistence({
      fetchImpl: async () => ({ ok: true, async json() { return { data: [] }; } }),
      backendUrl: "https://example.test/api",
      actualOrderId: "OM/2026/0009",
      dealerId: "44",
      submittedRows: [{ variantCode: "50/8", productNote: "Pack separately" }],
    }),
    /Actual PHP order ID is required/
  );
});

test("Duplicate SKUs are matched by occurrence and keep distinct fallback identities", () => {
  const matches = buildMatchedOrderRows(
    [
      { variantCode: "50/8", productNote: "First note" },
      { variantCode: "50/8", productNote: "Second note" },
    ],
    [
      { orderdata_id: "A1", orderdata_cat_no: "50/8" },
      { orderdata_id: "A2", orderdata_cat_no: "50/8" },
    ]
  );

  assert.deepEqual(
    matches.map((match) => ({
      occurrence: match.occurrence,
      orderItemId: match.phpRow?.orderdata_id,
    })),
    [
      { occurrence: 1, orderItemId: "A1" },
      { occurrence: 2, orderItemId: "A2" },
    ]
  );
});

test("Staff display prefers PHP remarks and does not duplicate the fallback note", () => {
  assert.equal(
    resolveDisplayRemark({
      remark: "Cat. No: 50/8 | Product note: Pack separately",
      fallbackNote: "Pack separately",
    }),
    "Cat. No: 50/8 | Product note: Pack separately"
  );

  const merged = mergeFallbackProductNotes(
    [
      {
        orderdata_id: "A1",
        orderdata_orderid: "910",
        orderdata_cat_no: "50/8",
        remark: "Cat. No: 50/8 | Priority delivery",
      },
    ],
    [
      {
        orderId: "910",
        orderItemId: "A1",
        normalizedSku: "50/8",
        occurrence: 1,
        note: "Pack separately",
      },
    ]
  );

  assert.equal(
    merged[0].displayRemark,
    "Cat. No: 50/8 | Priority delivery | Product note: Pack separately"
  );
});

test("Draft and reorder source paths still carry productNote fields", async () => {
  const [addOrderSource, draftsSource, orderDetailSource] = await Promise.all([
    readFile(addOrderPagePath, "utf8"),
    readFile(draftsPath, "utf8"),
    readFile(orderDetailPagePath, "utf8"),
  ]);

  assert.match(draftsSource, /productNote\?: string;/);
  assert.match(addOrderSource, /productNote:\s*String\(p\.productNote \?\? ""\)/);
  assert.match(addOrderSource, /productNote:\s*row\.productNote \?\? ""/);
  assert.match(addOrderSource, /maxLength=\{500\}/);
  assert.match(orderDetailSource, /api\/order-product-notes\?orderId=/);
  assert.match(orderDetailSource, /getremark\?id=/);
});
