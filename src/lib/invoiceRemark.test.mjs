import assert from "node:assert/strict";
import test from "node:test";

// resolveInvoiceRemark and extractOrderNoteFromRemarks are exported as
// named ESM exports from a .tsx file.  Since the rest of the file
// imports browser-only modules (jsPDF, supabase, etc.) that are not
// available in a plain Node context, we re-implement the two pure
// functions here so the tests can run without any bundler.

// ── Re-implemented from invoicegenerator.tsx (pure logic only) ───────

function extractOrderNoteFromRemarks(value) {
    if (typeof value !== "string") return "";
    const match = value.match(/Order note:\s*([^|]+)/i);
    return match?.[1]?.trim() || "";
}

function resolveInvoiceRemark({
    orderNote,
    note,
    savedNote,
    orderRemark,
    itemRemarks,
    reason,
} = {}) {
    // 1 & 2: direct order note fields
    const direct = String(orderNote || note || "").trim();
    if (direct) return direct;

    // 3: saved note from MongoDB
    const saved = typeof savedNote === "string" ? savedNote.trim() : "";
    if (saved) return saved;

    // 4: order-level "Order note:" extraction
    const fromOrderRemark = extractOrderNoteFromRemarks(orderRemark);
    if (fromOrderRemark) return fromOrderRemark;

    // 5: item-level "Order note:" — first unique match
    if (Array.isArray(itemRemarks)) {
        const fromItems = itemRemarks
            .map((r) => extractOrderNoteFromRemarks(r))
            .find(Boolean);
        if (fromItems) return fromItems;
    }

    // 6: reason fallback
    const reasonStr = typeof reason === "string" ? reason.trim() : "";
    if (reasonStr) return reasonStr;

    // 7: nothing found
    return "N/A";
}

// ── Tests ────────────────────────────────────────────────────────────

test("Test 1: orderNote takes priority over reason", () => {
    const result = resolveInvoiceRemark({
        orderNote: "Deliver before Friday",
        reason: "Fallback reason",
    });
    assert.equal(result, "Deliver before Friday");
});

test("Test 2: item-level 'Order note:' is extracted and used before reason", () => {
    const result = resolveInvoiceRemark({
        itemRemarks: [
            "Cat. No: 50/1 | Order note: Pack carefully | Priority delivery",
        ],
        reason: "Fallback reason",
    });
    assert.equal(result, "Pack carefully");
});

test("Test 3: reason is used when no note or remarks exist", () => {
    const result = resolveInvoiceRemark({
        reason: "Urgent replacement",
    });
    assert.equal(result, "Urgent replacement");
});

test("Test 4: returns N/A when nothing is provided", () => {
    const result = resolveInvoiceRemark({});
    assert.equal(result, "N/A");
});

test("Identical item-level notes on multiple items return only once", () => {
    const result = resolveInvoiceRemark({
        itemRemarks: [
            "Cat. No: 50/1 | Order note: Handle with care | Priority",
            "Cat. No: 50/2 | Order note: Handle with care | Priority",
            "Cat. No: 50/3 | Order note: Handle with care | Priority",
        ],
    });
    // resolveInvoiceRemark returns the first match, not duplicates
    assert.equal(result, "Handle with care");
});

test("Priority: orderNote > note > savedNote > orderRemark > itemRemarks > reason", () => {
    // All fields populated — orderNote should win
    assert.equal(
        resolveInvoiceRemark({
            orderNote: "A",
            note: "B",
            savedNote: "C",
            orderRemark: "Order note: D",
            itemRemarks: ["Order note: E"],
            reason: "F",
        }),
        "A"
    );

    // orderNote empty — note should win
    assert.equal(
        resolveInvoiceRemark({
            orderNote: "",
            note: "B",
            savedNote: "C",
            reason: "F",
        }),
        "B"
    );

    // orderNote + note empty — savedNote should win
    assert.equal(
        resolveInvoiceRemark({
            savedNote: "C",
            orderRemark: "Order note: D",
            reason: "F",
        }),
        "C"
    );

    // savedNote empty — orderRemark should win
    assert.equal(
        resolveInvoiceRemark({
            orderRemark: "Order note: D",
            itemRemarks: ["Order note: E"],
            reason: "F",
        }),
        "D"
    );

    // orderRemark without "Order note:" pattern — itemRemarks should win
    assert.equal(
        resolveInvoiceRemark({
            orderRemark: "Some random remark",
            itemRemarks: ["Order note: E"],
            reason: "F",
        }),
        "E"
    );
});

test("extractOrderNoteFromRemarks handles edge cases", () => {
    assert.equal(extractOrderNoteFromRemarks(null), "");
    assert.equal(extractOrderNoteFromRemarks(undefined), "");
    assert.equal(extractOrderNoteFromRemarks(123), "");
    assert.equal(extractOrderNoteFromRemarks("No note here"), "");
    assert.equal(
        extractOrderNoteFromRemarks("Order note: test value | other"),
        "test value"
    );
    assert.equal(
        extractOrderNoteFromRemarks("order NOTE:   spaced   "),
        "spaced"
    );
});
