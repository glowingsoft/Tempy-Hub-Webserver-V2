const { parsePaginationParams } = require("@utils/responseUtil");
const { respond } = require("@utils/controllerResponse");
const announcementService = require("@adminServices/staff/announcementService");

const scope = (req) => ({ actor: req.user, organizationId: req.orgId });

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
  listMine,
  getMine,
  acknowledgeAnnouncement,
};
