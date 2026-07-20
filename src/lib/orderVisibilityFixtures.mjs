export const STAFF_1 = "29";
export const STAFF_2 = "88";
export const DEALER_A = "101";
export const DEALER_B = "202";

function order(order_id, order_date, order_dealer, extra = {}) {
  return {
    order_id,
    order_date,
    order_dealer,
    Dealer_Name: order_dealer === DEALER_A ? "Assigned Dealer A" : "Unassigned Dealer B",
    assignedstaff: order_dealer === DEALER_A ? STAFF_1 : STAFF_2,
    accept_order: "1",
    del_status: "0",
    order_status: "pending",
    order_amount: "50000",
    order_discount: "50000",
    ...extra,
  };
}

export const ORDER_A_OLD = order("12001", "2026-07-12 23:59:59", DEALER_A, {
  search_marker: "old-flask-marker",
});
export const ORDER_B_REFERENCE = order(13001, "2026-07-13 00:00:00", DEALER_A, {
  search_marker: "assigned-flask-marker",
});
export const ORDER_C_LATER = order("14001", "2026-07-14 09:30:00", DEALER_A);
export const ORDER_D_UNASSIGNED = order(14002, "2026-07-14", DEALER_B, {
  search_marker: "unassigned-flask-marker",
});
export const ORDER_E_DEALER_A = order("15001", "2026-07-15", DEALER_A, {
  search_marker: "dealer-a-marker",
});
export const ORDER_F_DEALER_B = order(15002, "2026-07-15", DEALER_B, {
  search_marker: "dealer-b-marker",
});

export const ORDER_FIXTURES = [
  ORDER_A_OLD,
  ORDER_B_REFERENCE,
  ORDER_C_LATER,
  ORDER_D_UNASSIGNED,
  ORDER_E_DEALER_A,
  ORDER_F_DEALER_B,
];

export const STAFF_1_SCOPE = {
  role: "staff",
  actorId: STAFF_1,
  assignedDealerIds: [DEALER_A],
};
