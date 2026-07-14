import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

async function loadSessionModule() {
  const filePath = path.resolve("src/lib/auth/session.ts");
  const source = await fs.readFile(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;

  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`;
  return import(dataUrl);
}

const authSession = await loadSessionModule();

test("session tokens round-trip valid session payloads", () => {
  const now = Date.now();
  const session = authSession.buildPhpUserSession(
    { Dealer_Id: "225", Dealer_Name: "Alpha Labs", Dealer_City: "Delhi" },
    "2",
    now,
  );

  assert.ok(session);
  const token = authSession.encodeSessionToken(session, "secret-123");
  const decoded = authSession.decodeSessionToken(token, "secret-123");

  assert.equal(decoded?.role, "dealer");
  assert.equal(decoded?.dealerId, "225");
  assert.equal(decoded?.dealerName, "Alpha Labs");
});

test("tampered session tokens are rejected", () => {
  const now = Date.now();
  const session = authSession.buildAccountantSession(
    { _id: "acct-1", name: "Finance", email: "finance@example.com" },
    now,
  );

  assert.ok(session);
  const token = authSession.encodeSessionToken(session, "secret-123");
  const tampered = `${token.slice(0, -1)}x`;

  assert.equal(authSession.decodeSessionToken(tampered, "secret-123"), null);
});

test("protected APIs now depend on signed session helpers instead of actor headers", async () => {
  const dashboardSearchRoute = await fs.readFile(path.resolve("src/app/api/dashboard-search/route.ts"), "utf8");
  const pendingProductsRoute = await fs.readFile(path.resolve("src/app/api/pending-products/route.ts"), "utf8");
  const reportRoute = await fs.readFile(path.resolve("src/app/api/reports/dealer-category/route.ts"), "utf8");
  const dispatchRoute = await fs.readFile(path.resolve("src/app/api/order-dispatch/route.ts"), "utf8");

  assert.match(dashboardSearchRoute, /requireApiSession/);
  assert.match(pendingProductsRoute, /requireApiSession/);
  assert.match(reportRoute, /requireApiSession/);
  assert.match(dispatchRoute, /requireApiSession/);
  assert.doesNotMatch(dispatchRoute, /headers\.get\("x-omsons-actor-id"\)/);
});

test("route proxy checks for the signed session cookie before protected pages load", async () => {
  const source = await fs.readFile(path.resolve("proxy.ts"), "utf8");
  assert.match(source, /SESSION_COOKIE_NAME/);
  assert.match(source, /\/dashboard\/:path\*/);
  assert.match(source, /\/Pages\/:path\*/);
});
