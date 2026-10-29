const { getUserRoom } = require("./chatSocketRooms");

function getChatNamespace(ioOrNamespace) {
  if (!ioOrNamespace) return null;

  if (typeof ioOrNamespace.of === "function") {
    return ioOrNamespace.of("/chat");
  }

  return ioOrNamespace;
}

async function getConnectedUserIds(chatNamespace, userIds = []) {
  const connectedIds = [];

  await Promise.all(
    userIds.map(async (userId) => {
      const sockets = await chatNamespace.in(getUserRoom(userId)).allSockets();
      if (sockets.size > 0) {
        connectedIds.push(String(userId));
      }
    }),
  );

  return connectedIds;
}

function emitMessageToUsers({ ioOrNamespace, recipientIds = [], message }) {
  const chatNamespace = getChatNamespace(ioOrNamespace);
  if (!chatNamespace) return;

  recipientIds.forEach((recipientId) => {
    chatNamespace.to(getUserRoom(recipientId)).emit("receiveMessage", message);
  });
}

function emitMessageDeletedToUsers({
  ioOrNamespace,
  recipientIds = [],
  payload,
}) {
  const chatNamespace = getChatNamespace(ioOrNamespace);
  if (!chatNamespace) return;

  recipientIds.forEach((recipientId) => {
    chatNamespace.to(getUserRoom(recipientId)).emit("deleteMessage", payload);
  });
}

function emitChatUpdatedToUser({ ioOrNamespace, recipientId, payload }) {
  const chatNamespace = getChatNamespace(ioOrNamespace);
  if (!chatNamespace) return;

  chatNamespace.to(getUserRoom(recipientId)).emit("chatUpdated", payload);
}

module.exports = {
  getChatNamespace,
  getConnectedUserIds,
  emitMessageToUsers,
  emitMessageDeletedToUsers,
  emitChatUpdatedToUser,
};
