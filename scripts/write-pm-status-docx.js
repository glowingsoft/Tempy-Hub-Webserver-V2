const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require("../.tmp-docx/node_modules/docx");
const fs = require("fs");
const path = require("path");

const out = path.join(
  __dirname,
  "..",
  "docs",
  "TempyHub_Backend_Status_Done_InReview.docx"
);

const p = (text, opts = {}) =>
  new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: [
      new TextRun({
        text,
        font: "Calibri",
        size: 22,
        ...opts.run,
      }),
    ],
  });

const h = (text, level) =>
  new Paragraph({
    heading: level,
    spacing: { before: 280, after: 160 },
    children: [new TextRun({ text, font: "Calibri", bold: true })],
  });

const bullet = (text) =>
  new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, font: "Calibri", size: 22 })],
  });

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          {
            level: 0,
            format: "bullet",
            text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 180 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } },
      },
      children: [
        h("Tempy Hub — Backend status for PM checklist", HeadingLevel.TITLE),
        p("Date: 2 October 2026"),
        p(
          "This file lists only items that can be marked Done or In review on the PM backend checklist. It is not a full 92-task copy. APIs are shared across Owner, Site Manager, Line Manager and Staff — scope comes from membership, not separate backends."
        ),

        h("Mark Done", HeadingLevel.HEADING_1),

        h("Foundation, Auth & Multi-Tenancy", HeadingLevel.HEADING_2),
        bullet("Role-based authentication (Owner, Site Manager, Line Manager, Staff, platform admin)"),
        bullet("Permission / site scope (Site Manager cannot use another site)"),
        bullet("Organisation hierarchy (department, job title, reports-to)"),
        bullet("Live subordinates resolver (not cached)"),

        h("Organisation / Owner (Admin)", HeadingLevel.HEADING_2),
        bullet("Site add/edit (unique name; attendance settings, leave on/off, site manager)"),
        bullet("Assign / reassign Site Manager"),
        bullet("Department & Job Title CRUD"),
        bullet("Staff profiles (directory create / get / update)"),
        bullet("Module entitlement grant/revoke and gating on module routes"),

        h("Site Manager, Kiosk, Residents, Evacuation", HeadingLevel.HEADING_2),
        bullet("Kiosk device registration + branch activation code"),
        bullet("Admin kiosk list and get detail"),
        bullet("Kiosk staff search, preview, PIN clock-in / clock-out"),
        bullet("Visitor invite verify, resend, check-in, check-out, on-site, categories, policies"),
        bullet("Visitor walk-in approval (awaiting approval → approve)"),
        bullet("Resident list, add, get, edit + security password set/verify"),
        bullet("Fire drill start/close, on-site summary, staff mark-safe"),

        h("Line Manager & Employee (same APIs, scoped)", HeadingLevel.HEADING_2),
        bullet("Leave submit + entitlement balance"),
        bullet("Leave approve / decline"),
        bullet("Attendance correction request + approve"),
        bullet("My rota, open shifts, shift claim"),
        bullet("Phone check-in/out (site setting allowPhoneCheckIn)"),
        bullet("Employee evacuation: active event + mark myself safe"),

        h("Configuration (partial)", HeadingLevel.HEADING_2),
        bullet("Break rules on the site (enable breaks, paid/unpaid bands)"),

        h("Mark In review", HeadingLevel.HEADING_1),
        p("Built in part, but not the full wording on the PM checklist."),
        bullet("Tenant isolation automated tests"),
        bullet("Session inactivity timeout (JWT exists; confirm vs inactivity rule)"),
        bullet("Site delete / remove"),
        bullet("Kiosk Admin PIN reset (PIN only at register; not checked later)"),
        bullet("Kiosk branding, screen timeout, per-kiosk override"),
        bullet("QR as its own check-in method (today invite QR = 6-digit invite code)"),
        bullet("PIN 3-attempt lockout + admin reset"),
        bullet("5-second visitor approval polling (approve API exists; polling is frontend)"),
        bullet("Resident password access log"),
        bullet("Rota view modes: My / My team / All teams as three API modes"),
        bullet("Headcount limit before leave approve"),
        bullet("Offline phone queue keeping capture-time"),
        bullet("Fire: Smoke vs Real + Emergency PIN client sign-off"),
        bullet("Mark-safe high-PEEP first"),
        bullet("Express check-in, checkout reason list, hide breaks when site has breaks off"),

        h("Do not mark done", HeadingLevel.HEADING_1),
        bullet("PEEP and floor-plan pins"),
        bullet("Tempy integration"),
        bullet("Competency, supervision, appraisal, training"),
        bullet("Billing & usage, workforce overview, Total Professionals"),
        bullet("Kiosk home widgets, visitor survey"),

        h("Note for PM", HeadingLevel.HEADING_1),
        p(
          "One line: APIs are shared. Owner vs Site Manager vs Line Manager is membership scope, not three separate API trees."
        ),
      ],
    },
  ],
});

fs.mkdirSync(path.dirname(out), { recursive: true });
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log(out);
});
