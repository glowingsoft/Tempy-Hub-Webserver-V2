const { sendResponse } = require("@utils/responseUtil");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");

/**
 * Answers a PDF download. With ?format=url and a stored copy it returns a short-lived signed link to the file in S3;
 * otherwise (previews drawn on demand, or no format) the PDF itself is streamed.
 */
const sendPdf = async ({ req, res, pdf, attachment }) => {
  if (req.query.format === "url" && pdf.key) {
    const { url, expiresAt } = await uploadAwsService.signedPdfUrl({
      key: pdf.key,
      filename: pdf.filename,
      attachment,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: { url, expiresAt, filename: pdf.filename },
    });
  }

  res.set({
    "Content-Type": "application/pdf",
    "Content-Length": pdf.buffer.length,
    "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${pdf.filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  return res.status(200).send(pdf.buffer);
};

module.exports = { sendPdf };
