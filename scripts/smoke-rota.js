/**
 * Quick rota smoke test against local dev server.
 * Usage: node scripts/smoke-rota.js
 */
const BASE = "http://localhost:6060/api/v1";
const ADMIN_TOKEN = process.env.ADMIN_ACCESS_TOKEN;

async function request(method, path, { token, orgId, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers["x-org-id"] = orgId;
  if (ADMIN_TOKEN) headers["x-admin-access-token"] = ADMIN_TOKEN;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${json.message || res.statusText}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function main() {
  const steps = [];

  const login = await request("POST", "/auth/login", {
    body: {
      email: process.env.BOOTSTRAP_OWNER_EMAIL || "owner@tempyhub.com",
      password: process.env.BOOTSTRAP_OWNER_PASSWORD || "ownerTempy11",
      audience: "staff",
      deviceId: "smoke-rota-device",
      deviceType: "web",
      timezone: "Europe/London",
    },
  });
  const token = login.data.token;
  steps.push("login");

  const orgs = await request("GET", "/admin/organizations", { token });
  const org = orgs.data?.[0];
  if (!org?._id) throw new Error("No organization found");
  const orgId = org._id;
  steps.push("list orgs");

  let branches = await request("GET", `/admin/organizations/${orgId}/branches`, { token, orgId });
  let branch = branches.data?.[0];
  if (!branch) {
    const created = await request("POST", `/admin/organizations/${orgId}/branches`, {
      token,
      orgId,
      body: { name: "Smoke Test Site", address: { line1: "1 Test St" } },
    });
    branch = created.data;
  }
  const branchId = branch._id;
  steps.push("branch ready");

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(9, 0, 0, 0);
  const end = new Date(tomorrow);
  end.setUTCHours(17, 0, 0, 0);

  const shiftRes = await request("POST", `/admin/organizations/${orgId}/shifts`, {
    token,
    orgId,
    body: {
      branchId,
      startsAt: tomorrow.toISOString(),
      endsAt: end.toISOString(),
      visibility: "branch",
    },
  });
  const shiftId = shiftRes.data._id;
  steps.push("create shift");

  await request("GET", `/admin/organizations/${orgId}/shifts?page=1&limit=5`, { token, orgId });
  steps.push("list shifts");

  await request("GET", `/admin/shifts/${shiftId}`, { token, orgId });
  steps.push("get shift");

  try {
    await request("GET", "/app/shifts/open", { token, orgId });
    steps.push("app open shifts (owner may lack staff profile)");
  } catch (e) {
    if (e.status === 403) steps.push("app open shifts blocked (no staff profile — expected for owner)");
    else throw e;
  }

  console.log("Rota smoke test OK:", steps.join(" -> "));
  console.log({ orgId, branchId, shiftId });
}

main().catch((err) => {
  console.error("Rota smoke test FAILED:", err.message);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
