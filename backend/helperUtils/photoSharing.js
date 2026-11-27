const isSharing = (resident) => resident?.photographyConsent === true;

const hasSharedPhotos = (resident) =>
  isSharing(resident) || Boolean(resident?.photoSharingStoppedAt);

const canShowPhoto = (resident, sharedAt) =>
  isSharing(resident) ||
  Boolean(
    resident?.photoSharingStoppedAt &&
      sharedAt &&
      sharedAt <= resident.photoSharingStoppedAt,
  );

const sharedPhotoMatch = (resident, field) =>
  isSharing(resident)
    ? {}
    : { [field]: { $lte: resident.photoSharingStoppedAt } };

module.exports = {
  isSharing,
  hasSharedPhotos,
  canShowPhoto,
  sharedPhotoMatch,
};
