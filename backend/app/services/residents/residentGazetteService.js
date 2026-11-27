const { FamilyGazetteItem } = require("@models/FamilyGazetteItem");
const { AppError } = require("@services/_errors/AppError");
const { generateMeta } = require("@utils/responseUtil");
const {
  toObjectId,
  isValidObjectId,
} = require("@appServices/family/familyPipeline");
const {
  isFamilyModuleActive,
} = require("@appServices/family/familyAccessService");
const familyGazettes = require("@appServices/family/familyGazetteService");
const {
  loadSharing,
  latestPrintedGazette,
} = require("./residentFamilyService");

const listGazettes = async ({ resident, page, limit, skip }) => {
  const sharing = await loadSharing(resident.residentId);
  if (!isFamilyModuleActive(sharing.organization)) {
    return { data: [], meta: generateMeta(page, limit, 0) };
  }
  return familyGazettes.listGazettes({
    link: {
      residentId: resident.residentId,
      organizationId: sharing.organizationId,
      branchId: resident.branchId,
    },
    page,
    limit,
    skip,
  });
};

const getGazette = async ({ resident, sharing, gazetteId }) => {
  if (!isValidObjectId(gazetteId)) {
    throw new AppError("gazette_not_found", 404);
  }
  const [item] = await FamilyGazetteItem.aggregate([
    {
      $match: {
        _id: toObjectId(gazetteId),
        residentId: toObjectId(resident.residentId),
        organizationId: toObjectId(sharing.organizationId),
      },
    },
    { $project: { branchId: 1 } },
  ]);
  if (!item) throw new AppError("gazette_not_found", 404);

  return familyGazettes.getGazette({
    links: [
      {
        residentId: resident.residentId,
        organizationId: sharing.organizationId,
        branchId: item.branchId,
      },
    ],
    gazetteId: String(gazetteId),
  });
};

const getGazetteById = async ({ resident, gazetteId }) => {
  const sharing = await loadSharing(resident.residentId);
  if (!isFamilyModuleActive(sharing.organization)) {
    throw new AppError("gazette_not_found", 404);
  }
  return getGazette({ resident, sharing, gazetteId });
};

const getGazetteScreen = async ({ resident }) => {
  const sharing = await loadSharing(resident.residentId);
  const latest = isFamilyModuleActive(sharing.organization)
    ? await latestPrintedGazette({
        residentId: resident.residentId,
        organizationId: sharing.organizationId,
      })
    : null;
  if (!latest) throw new AppError("gazette_not_found", 404);

  return getGazette({ resident, sharing, gazetteId: latest.gazetteId });
};

module.exports = { listGazettes, getGazetteById, getGazetteScreen };
