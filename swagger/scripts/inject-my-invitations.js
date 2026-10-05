const fs = require("fs");

const FILE = "./swagger/swagger_output.json";
const spec = JSON.parse(fs.readFileSync(FILE, "utf8"));

const bearer = [{ bearerAuth: [] }];
const ok = {
  description: "OK",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiResponse" },
    },
  },
};
const tag = ["Memberships"];

if (!spec.tags.find((t) => t.name === "Memberships")) {
  spec.tags.push({
    name: "Memberships",
    description:
      "Organization members, role and scope changes, and staff invitations.",
  });
}

spec.paths["/app/invitations"] = {
  get: {
    tags: tag,
    summary: "List my pending invitations",
    description:
      "Authenticated inbox for invitations sent to the logged-in user's email. Use this when an existing staff member is invited to another org or branch.",
    security: bearer,
    parameters: [
      { name: "page", in: "query", schema: { type: "integer", default: 1 } },
      { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
    ],
    responses: {
      200: ok,
      401: { description: "Unauthorized" },
    },
  },
};

spec.paths["/app/invitations/{invitationId}"] = {
  get: {
    tags: tag,
    summary: "Get one of my pending invitations",
    security: bearer,
    parameters: [
      {
        name: "invitationId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: {
      200: ok,
      401: { description: "Unauthorized" },
      404: { description: "Not found" },
    },
  },
};

spec.paths["/app/invitations/{invitationId}/accept"] = {
  post: {
    tags: tag,
    summary: "Accept one of my pending invitations",
    description:
      "No password required — the session already proves email ownership. Creates membership (and staff profile when the invitation includes employment fields).",
    security: bearer,
    parameters: [
      {
        name: "invitationId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: {
      200: ok,
      400: { description: "Expired" },
      401: { description: "Unauthorized" },
      404: { description: "Not found" },
      409: { description: "Already a member" },
    },
  },
};

fs.writeFileSync(FILE, JSON.stringify(spec, null, 2));
console.log("swagger my-invitations paths injected");
