const { Branch } = require("@models/Branch");
const Faq = require("@models/Faq");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId } = require("./familyPipeline");

const MAX_FAQS = 50;

const DEFAULT_FAQS = [
  {
    id: "photo",
    question: "Why hasn't my photo appeared?",
    answer:
      "The home checks every photo and message before it appears. In My Uploads, Waiting For Approval means it has not been checked yet. Not Approved shows the reason, and you can edit it and send it again.",
  },
  {
    id: "gazette",
    question: "When is the gazette printed?",
    answer:
      "The home prints a gazette for each issue period. The Gazette Due card on your Home screen shows when the next one closes. Send your photos and messages before then and choose to include them in the gazette.",
  },
  {
    id: "visit",
    question: "How do I book a visit?",
    answer:
      "Open My Visits and tap Book A Visit. Choose a day, a time and how many people are coming. The home confirms or declines your request, and a confirmed visit has a visit pass.",
  },
  {
    id: "invite",
    question: "How do I invite my brother?",
    answer:
      "The next of kin can invite relatives by email or share the family code from My Family. Someone who joins with the code is added once their request is approved. If you are not the next of kin, ask them to invite your brother.",
  },
];

const faqsForFamily = async () => {
  const rows = await Faq.find({ audience: "family" })
    .sort({ createdAt: 1 })
    .limit(MAX_FAQS)
    .select("question answer")
    .lean();
  if (!rows.length) return DEFAULT_FAQS;
  return rows.map(({ _id, question, answer }) => ({
    id: String(_id),
    question,
    answer,
  }));
};

const getHelp = async ({ link }) => {
  const [[branch], faqs] = await Promise.all([
    Branch.aggregate([
      {
        $match: {
          _id: toObjectId(link.branchId),
          organizationId: toObjectId(link.organizationId),
        },
      },
      { $project: { name: 1, reception: 1 } },
    ]),
    faqsForFamily(),
  ]);
  if (!branch) throw new AppError("branch_not_found", 404);

  const reception = branch.reception || {};
  return {
    homeName: branch.name,
    contact: {
      name: reception.name || `${branch.name} Reception`,
      email: reception.email || "",
      phone: reception.phone || "",
      opensAt: reception.opensAt || "",
      closesAt: reception.closesAt || "",
    },
    faqs,
  };
};

module.exports = { getHelp };
