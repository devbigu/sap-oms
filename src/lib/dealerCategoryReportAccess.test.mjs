import assert from "node:assert/strict";
import test from "node:test";

import dealerCategoryReportAccess from "./dealerCategoryReportAccess.js";

const { buildDealerSelectionPage, canStaffAccessDealer } = dealerCategoryReportAccess;

const allDealers = [
  { Dealer_Id: "D-1", Dealer_Name: "Desk Scientific", Dealer_City: "Mumbai", Dealer_Dealercode: "DS-01" },
  { Dealer_Id: "D-2", Dealer_Name: "Bright Labs", Dealer_City: "Delhi", Dealer_Dealercode: "BL-07" },
  { Dealer_Id: "D-3", Dealer_Name: "North Glass", Dealer_City: "Pune", Dealer_Dealercode: "NG-11" },
];

test("Admin can select any dealer through the paginated selector helper", () => {
  const page = buildDealerSelectionPage({
    dealers: allDealers,
    search: "",
    page: 1,
    pageSize: 10,
  });

  assert.equal(page.total, 3);
  assert.deepEqual(page.data.map((dealer) => dealer.Dealer_Id), ["D-1", "D-2", "D-3"]);
});

test("Staff selector shows only the assigned dealers supplied to it", () => {
  const page = buildDealerSelectionPage({
    dealers: [allDealers[0], allDealers[2]],
    search: "north",
    page: 1,
    pageSize: 10,
  });

  assert.equal(page.total, 1);
  assert.deepEqual(page.data.map((dealer) => dealer.Dealer_Id), ["D-3"]);
});

test("Staff cannot request an unassigned dealer report", () => {
  assert.equal(canStaffAccessDealer([allDealers[0], allDealers[2]], "D-1"), true);
  assert.equal(canStaffAccessDealer([allDealers[0], allDealers[2]], "D-2"), false);
});
