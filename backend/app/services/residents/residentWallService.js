const { generateMeta } = require("@utils/responseUtil");
const {
  isFamilyModuleActive,
} = require("@appServices/family/familyAccessService");
const familyWall = require("@appServices/family/familyWallService");
const { loadSharing } = require("./residentFamilyService");

const listWall = async ({ resident, userId, page, limit, skip }) => {
  const sharing = await loadSharing(resident.residentId);
  if (!isFamilyModuleActive(sharing.organization)) {
    return { data: [], meta: generateMeta(page, limit, 0) };
  }

  const link = {
    residentId: resident.residentId,
    organizationId: sharing.organizationId,
    branchId: resident.branchId,
  };
  return familyWall.listWall({
    link,
    links: [link],
    userId,
    page,
    limit,
    skip,
  });
};

module.exports = { listWall };
