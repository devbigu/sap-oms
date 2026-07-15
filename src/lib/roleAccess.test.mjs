import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/roleAccess.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

const module = { exports: {} };
vm.runInNewContext(compiled, {
  module,
  exports: module.exports,
  require,
  Buffer,
  atob,
}, { filename: sourcePath });

const {
  canAccessRoute,
  getAllowedRoles,
  getRoleHome,
  resolveStoredAuth,
} = module.exports;

function storage(values = {}) {
  const map = new Map(Object.entries(values));
  return {
    removed: [],
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    removeItem(key) {
      this.removed.push(key);
      map.delete(key);
    },
  };
}

function json(value) {
  return JSON.stringify(value);
}

assert.equal(getAllowedRoles("/Products"), null, "public product route stays public");
assert.equal(resolveStoredAuth(storage()).status, "unauthenticated", "missing auth is not admin");
assert.equal(resolveStoredAuth(storage({ UserData: "{" })).reason, "invalid", "invalid JSON redirects safely");
assert.equal(resolveStoredAuth(storage({ UserData: json({ name: "No Role" }) })).reason, "unsupported-role", "missing role is not admin");
assert.equal(resolveStoredAuth(storage({ UserData: json({ name: "Mystery" }), roletype: "99" })).reason, "unsupported-role", "unknown role is not admin");

assert.equal(resolveStoredAuth(storage({ UserData: json({ name: "A" }), roletype: "3" })).role, "admin");
assert.equal(resolveStoredAuth(storage({ UserData: json({ staff_id: "s1", staff_roletype: "1" }) })).role, "staff");
assert.equal(resolveStoredAuth(storage({ UserData: json({ staff_id: "s2", staff_roletype: "2" }), roletype: "1" })).role, "staff");
assert.equal(resolveStoredAuth(storage({ staffData: json({ staff_id: "s3", staff_roletype: "2" }) })).role, "staff");
assert.equal(resolveStoredAuth(storage({ UserData: json({ Dealer_Id: "d1", Dealer_Name: "D" }) })).role, "dealer");

assert.equal(canAccessRoute("admin", "/dashboard/admin/custom-discount-approvals"), true);
assert.equal(canAccessRoute("staff", "/dashboard/admin/custom-discount-approvals"), false);
assert.equal(canAccessRoute("dealer", "/dashboard/admin/custom-discount-approvals"), false);
assert.equal(canAccessRoute("staff", "/dashboard/staff"), true);
assert.equal(canAccessRoute("dealer", "/dashboard/staff"), false);
assert.equal(canAccessRoute("dealer", "/dashboard/dealer/AddOrderForm"), true);
assert.equal(canAccessRoute("admin", "/dashboard/dealer/AddOrderForm"), false);
assert.equal(canAccessRoute("staff", "/dashboard/admin/dealer/AddDealerForm"), true, "staff keeps intended add-dealer route");
assert.equal(canAccessRoute("staff", "/dashboard/admin/dealer/225"), true, "staff keeps intended dealer detail route");
assert.equal(canAccessRoute("staff", "/dashboard/admin/ledger"), true, "staff keeps intended ledger route");
assert.equal(canAccessRoute("accountant", "/dashboard/admin/ledger"), true, "accountant keeps intended ledger route");

for (const role of ["admin", "staff", "dealer", "accountant"]) {
  assert.equal(canAccessRoute(role, "/Pages/Ordermanagement"), true, `${role} can open shared order list`);
  assert.equal(canAccessRoute(role, "/orders/123"), true, `${role} can open guarded order detail`);
}

assert.equal(canAccessRoute("dealer", "/Pages/products/addproducts"), false);
assert.equal(canAccessRoute("admin", "/Pages/products/addproducts"), true);
assert.equal(canAccessRoute("staff", "/Pages/Cart"), false);
assert.equal(canAccessRoute("dealer", "/Pages/Cart"), true);
assert.equal(getRoleHome("admin"), "/dashboard/admin");
assert.equal(getRoleHome("staff"), "/dashboard/staff");
assert.equal(getRoleHome("dealer"), "/home");
assert.equal(getRoleHome("accountant"), "/dashboard/accountant");

console.log("roleAccess policy tests passed");
