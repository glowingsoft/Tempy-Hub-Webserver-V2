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

spec.paths["/auth/change-password"] = {
  post: {
    tags: ["auth"],
    summary: "Change password while logged in",
    description:
      "Requires the current password. Use forgot-password + reset-password when the user cannot sign in.",
    security: bearer,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["oldPassword", "newPassword"],
            properties: {
              oldPassword: { type: "string" },
              newPassword: { type: "string", minLength: 6 },
            },
          },
        },
      },
    },
    responses: { 200: ok, 400: { description: "Wrong or same password" } },
  },
};

spec.paths["/app/users/profile"] = {
  get: {
    tags: ["users"],
    summary: "Get my profile",
    description:
      "Returns the User profile. Send x-org-id to also attach staffProfile for that organisation.",
    security: bearer,
    parameters: [
      {
        name: "x-org-id",
        in: "header",
        required: false,
        schema: { type: "string" },
      },
    ],
    responses: { 200: ok },
  },
  put: {
    tags: ["users"],
    summary: "Update my profile",
    description:
      "Updates User name/phone/photo. With x-org-id also updates StaffProfile phone and photoUrl.",
    security: bearer,
    parameters: [
      {
        name: "x-org-id",
        in: "header",
        required: false,
        schema: { type: "string" },
      },
    ],
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              phoneNumber: { type: "string" },
              profileIcon: { type: "string" },
            },
          },
        },
      },
    },
    responses: { 200: ok },
  },
};

fs.writeFileSync(FILE, JSON.stringify(spec, null, 2));
console.log("swagger profile/auth injected");
