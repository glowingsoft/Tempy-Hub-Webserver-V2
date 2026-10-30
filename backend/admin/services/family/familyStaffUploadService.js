const { AppError } = require("@services/_errors/AppError");
const familyUploadService = require("@appServices/family/familyUploadService");
const { isValidObjectId } = require("@appServices/family/familyPipeline");
const { requireManageableResident } = require("./familyService");

const sendUpload = async ({
  actor,
  organizationId,
  residentId,
  message,
  mediaIds,
  includeInGazette,
  clientId,
}) => {
  if (!isValidObjectId(residentId)) throw new AppError("resident_not_found", 404);
  const resident = await requireManageableResident({ actor, organizationId, residentId });

  return familyUploadService.createUpload({
    userId: actor._id,
    link: {
      organizationId: resident.organizationId,
      branchId: resident.branchId,
      residentId: resident._id,
    },
    message,
    mediaIds,
    includeInGazette,
    clientId,
  });
};

module.exports = { sendUpload };
