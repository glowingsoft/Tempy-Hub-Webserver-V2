const { parsePaginationParams } = require("@utils/responseUtil");
const { respond } = require("@utils/controllerResponse");
const announcementService = require("@adminServices/staff/announcementService");

const scope = (req) => ({ actor: req.user, organizationId: req.orgId });

const listAnnouncements = respond(
  (req) =>
    announcementService.listAnnouncements({
      ...scope(req),
      branchId: req.query.branchId,
      ...parsePaginationParams(req),
    }),
  { paged: true },
);

const getAnnouncement = respond((req) =>
  announcementService.getAnnouncement({
    ...scope(req),
    announcementId: req.params.announcementId,
  }),
);

const createAnnouncement = respond(
  (req) =>
    announcementService.createAnnouncement({
      ...scope(req),
      branchId: req.body.branchId,
      subject: req.body.subject,
      description: req.body.description,
      category: req.body.category,
      departmentIds: req.body.departmentIds,
      audience: req.body.audience,
    }),
  { statusCode: 201, translationKey: "announcement_created" },
);

const remindAnnouncement = respond(
  (req) =>
    announcementService.remindAnnouncement({
      ...scope(req),
      announcementId: req.params.announcementId,
    }),
  { translationKey: "announcement_reminded" },
);

const listMine = respond(
  (req) =>
    announcementService.listMine({
      ...scope(req),
      ...parsePaginationParams(req),
    }),
  { paged: true },
);

const getMine = respond((req) =>
  announcementService.getMine({
    ...scope(req),
    announcementId: req.params.announcementId,
  }),
);

const acknowledgeAnnouncement = respond(
  (req) =>
    announcementService.acknowledgeAnnouncement({
      ...scope(req),
      announcementId: req.params.announcementId,
      acknowledge: req.body?.acknowledged,
    }),
  { translationKey: "announcement_acknowledged" },
);

module.exports = {
  listAnnouncements,
  getAnnouncement,
  createAnnouncement,
  remindAnnouncement,
  listMine,
  getMine,
  acknowledgeAnnouncement
};
