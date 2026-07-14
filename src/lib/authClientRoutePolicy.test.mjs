import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function loadAuthModules() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omsons-auth-"));
  const clientSource = await fs.readFile(path.resolve("src/lib/auth/client.ts"), "utf8");
  const routePolicySource = await fs.readFile(path.resolve("src/lib/auth/routePolicy.ts"), "utf8");

  const transpile = (source, fileName) =>
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
      fileName,
    }).outputText;

  await fs.writeFile(path.join(tempDir, "client.mjs"), transpile(clientSource, "client.ts"));
  await fs.writeFile(
    path.join(tempDir, "routePolicy.mjs"),
    transpile(
      routePolicySource.replaceAll("@/lib/auth/client", "./client.mjs"),
      "routePolicy.ts",
    ),
  );

  const client = await import(pathToFileURL(path.join(tempDir, "client.mjs")).href);
  const routePolicy = await import(pathToFileURL(path.join(tempDir, "routePolicy.mjs")).href);

  return { client, routePolicy };
}

function createStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

function buildToken(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

const { client, routePolicy } = await loadAuthModules();

test("staff admin records resolve to admin without falling back from missing metadata", () => {
  const resolution = client.readLocalAuthResolution(
    createStorage({
      staffData: JSON.stringify({
        staff_id: "ST-7",
        staff_name: "Asha",
        staff_roletype: "0",
      }),
    }),
  );

  assert.equal(resolution.status, "authenticated");
  assert.equal(resolution.session.role, "admin");
  assert.equal(resolution.session.staffId, "ST-7");
});

test("orphaned auth metadata is treated as invalid instead of admin", () => {
  const resolution = client.readLocalAuthResolution(
    createStorage({
      status: "true",
      roletype: "3",
    }),
  );

  assert.equal(resolution.status, "invalid");
  assert.match(resolution.reason, /without a usable user record/i);
});

test("accountant auth requires both a live token and stored account data", () => {
  const validToken = buildToken({ exp: Math.floor(Date.now() / 1000) + 3600 });

  const okResolution = client.readLocalAuthResolution(
    createStorage({
      accountant_token: validToken,
      AccountantData: JSON.stringify({
        _id: "acct-9",
        name: "Finance Team",
        email: "finance@example.com",
      }),
    }),
  );

  const invalidResolution = client.readLocalAuthResolution(
    createStorage({
      accountant_token: validToken,
    }),
  );

  assert.equal(okResolution.status, "authenticated");
  assert.equal(okResolution.session.role, "accountant");
  assert.equal(invalidResolution.status, "invalid");
});

test("route policy protects admin product pages and dealer drafts centrally", () => {
  assert.equal(routePolicy.isRoleAllowed("/Pages/products/addproducts", "admin"), true);
  assert.equal(routePolicy.isRoleAllowed("/Pages/products/addproducts", "dealer"), false);
  assert.equal(routePolicy.isRoleAllowed("/Pages/products/edit/42", "staff"), false);
  assert.equal(routePolicy.isRoleAllowed("/drafts", "dealer"), true);
  assert.equal(routePolicy.isRoleAllowed("/drafts", "accountant"), false);
});

test("route policy preserves shared exceptions and role-specific login redirects", () => {
  assert.equal(routePolicy.isRoleAllowed("/dashboard/admin/dealer/DealerList", "accountant"), true);
  assert.equal(routePolicy.isRoleAllowed("/dashboard/admin/dealer/DealerList", "staff"), false);
  assert.equal(
    routePolicy.buildLoginRedirect("/dashboard/accountant/order-book"),
    "/auth/accountant-login?next=%2Fdashboard%2Faccountant%2Forder-book",
  );

  assert.equal(
    routePolicy.getUnauthorizedRedirect(
      { role: "dealer", userId: "D-1", roletype: "2", name: "Dealer", dealerId: "D-1", source: "UserData" },
      "/dashboard/admin",
    ),
    "/home",
  );
});
