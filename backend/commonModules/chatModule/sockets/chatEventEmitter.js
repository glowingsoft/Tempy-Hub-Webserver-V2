const { getUserRoom } = require("./chatSocketRooms");

const getChatNamespace = (ioOrNamespace) => {
  if (!ioOrNamespace) return null;
  return typeof ioOrNamespace.of === "function"
    ? ioOrNamespace.of("/chat")
    : ioOrNamespace;
};

const emitMessageToUsers = ({ ioOrNamespace, recipientIds = [], message }) => {
  const chatNamespace = getChatNamespace(ioOrNamespace);
  if (!chatNamespace) return;

  recipientIds.forEach((recipientId) => {
    chatNamespace.to(getUserRoom(recipientId)).emit("receiveMessage", message);
  });
};

module.exports = { emitMessageToUsers };
