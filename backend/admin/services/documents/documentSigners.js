const signerMatch = (staffId, branchId) => ({
  $or: [
    { "signers.staffId": staffId },
    { signersOnly: { $ne: true }, "signers.branchId": { $ne: branchId } },
  ],
});

const mustSign = (document, staff) => {
  const signers = document.signers || [];
  if (signers.some((row) => String(row.staffId) === String(staff._id))) {
    return true;
  }
  return (
    !document.signersOnly &&
    !signers.some((row) => String(row.branchId) === String(staff.branchId))
  );
};

module.exports = { signerMatch, mustSign };
