const jsonBody = (example) => ({
  required: true,
  content: {
    "application/json": {
      schema: { type: "object" },
      example,
    },
  },
});

const multipartFilesBody = (field, { multiple = false } = {}) => ({
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        required: [field],
        properties: {
          [field]: multiple
            ? {
                type: "array",
                items: { type: "string", format: "binary" },
                description: "Images or PDF (jpeg, png, gif, bmp, tiff, webp, pdf). Max 20.",
              }
            : { type: "string", format: "binary" },
        },
      },
    },
  },
});

/** Fallback bodies when Postman did not match the live path. */
const BODIES = [
  {
    method: "POST",
    test: (path) => path.endsWith("/auth/login"),
    body: jsonBody({
      email: "admin@tempyhub.com",
      password: "adminTempy11",
      audience: "staff",
      surface: "staffApp",
    }),
  },
  {
    method: "POST",
    test: (path) => /\/organizations\/\{[^}]+}\/peep-records$/.test(path),
    body: jsonBody({
      residentId: "residentId",
      peepLevel: "high",
      supportNeeds: "Full assistance during evacuation.",
      primaryRoute: "Main stairwell",
      secondaryRoute: "Lift lobby to rear exit",
      equipmentRequired: "Evac chair",
      responsibleStaff: "Night coordinator",
    }),
  },
  {
    method: "PATCH",
    test: (path) => /\/peep-records\/\{[^}]+}$/.test(path),
    body: jsonBody({
      peepLevel: "medium",
      supportNeeds: "Partial assistance on stairs.",
      primaryRoute: "Main stairwell",
      secondaryRoute: "",
      equipmentRequired: "Evac chair",
      responsibleStaff: "Night coordinator",
    }),
  },
  {
    method: "POST",
    test: (path) => /\/organizations\/\{[^}]+}\/floor-plans$/.test(path),
    body: jsonBody({
      branchId: "branchId",
      name: "Ground Floor",
      imageUrl: "",
      pdfUrl: "",
    }),
  },
  {
    method: "PATCH",
    test: (path) => /\/floor-plans\/\{[^}]+}$/.test(path),
    body: jsonBody({
      name: "Ground Floor",
      imageUrl: "https://example.com/plan.png",
      pdfUrl: "",
    }),
  },
  {
    method: "PUT",
    test: (path) => /\/floor-plans\/\{[^}]+}\/pins$/.test(path),
    body: jsonBody({
      residentId: "residentId",
      x: 0.42,
      y: 0.61,
    }),
  },
  {
    method: "POST",
    test: (path) => path === "/admin/residents" || path.endsWith("/residents"),
    body: jsonBody({
      branchId: "branchId",
      name: "Jane Resident",
      roomNumber: "12",
      email: "jane@example.com",
      phone: "",
    }),
  },
  {
    method: "PATCH",
    test: (path) => /\/residents\/\{[^}]+}$/.test(path),
    body: jsonBody({
      name: "Jane Resident",
      roomNumber: "12",
      phone: "",
    }),
  },
  {
    method: "POST",
    test: (path) => /\/organizations\/\{[^}]+}\/invitations$/.test(path),
    body: jsonBody({
      email: "sm@example.com",
      name: "Alex Khan",
      role: "siteManager",
      branchId: "branchId",
      permissions: ["leave.view", "leave.manage", "residents.view"],
    }),
  },
  {
    method: "POST",
    test: (path) => path === "/app/kiosk/session" || path.endsWith("/kiosk/session"),
    body: jsonBody({
      branchId: "branchId",
      deviceId: "dummy-kiosk-device-1",
      adminPin: "121212",
    }),
  },
  {
    method: "POST",
    replace: true,
    test: (path) => path === "/upload/s3" || path.endsWith("/upload/s3"),
    body: multipartFilesBody("files", { multiple: true }),
  },
  {
    method: "POST",
    replace: true,
    test: (path) => path === "/upload" || path.endsWith("/upload"),
    body: multipartFilesBody("file"),
  },
];

const attachBody = (method, path, operation) => {
  if (!["POST", "PUT", "PATCH"].includes(String(method).toUpperCase())) {
    return operation;
  }
  const match = BODIES.find(
    (entry) =>
      entry.method === String(method).toUpperCase() && entry.test(path)
  );
  if (!match) return operation;
  if (operation.requestBody && !match.replace) return operation;
  return { ...operation, requestBody: match.body };
};

module.exports = { attachBody };
