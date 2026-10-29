const { parsePaginationParams } = require("@utils/responseUtil");
const { respond } = require("@utils/controllerResponse");
const { queryText, queryId } = require("@utils/familyQuery");
const familyMessageService = require("@appServices/family/familyMessageService");
const familyMessageStaffService = require("@adminServices/family/familyMessageStaffService");

const listChats = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyMessageService.listThreads({
      userId: req.user._id,
      tab: queryText(req.query.chatState) || undefined,
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const listChatMessages = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyMessageService.listMessages({
      userId: req.user._id,
      conversationId: queryText(req.query.conversationId),
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const updateChat = respond(
  (req) =>
    familyMessageService.updateThread({
      userId: req.user._id,
      conversationId: req.params.conversationId,
      action: req.body?.action,
    }),
  { translationKey: "chat_updated" },
);

const sendMessage = respond(
  (req) =>
    familyMessageStaffService.sendMessage({
      actor: req.user,
      organizationId: req.orgId,
      branchId: queryId(req.body?.branchId, "branchId"),
      audience: req.body?.audience,
      residentIds: req.body?.residentIds,
      message: req.body?.message,
    }),
  { statusCode: 201, translationKey: "message_sent" },
);

const listSentMessages = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyMessageStaffService.listSent({
      actor: req.user,
      organizationId: req.orgId,
      branchId: queryId(req.query.branchId, "branchId"),
      keyword: queryText(req.query.keyword),
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const getSentMessage = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyMessageStaffService.getSent({
      actor: req.user,
      organizationId: req.orgId,
      broadcastId: req.params.broadcastId,
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

module.exports = {
  listChats,
  listChatMessages,
  updateChat,
  sendMessage,
  listSentMessages,
  getSentMessage,
};
