const getUserRoom = (userId) => `user:${String(userId)}`;
const getOrgRoom = (organizationId) => `org:${String(organizationId)}`;

module.exports = { getUserRoom, getOrgRoom };
