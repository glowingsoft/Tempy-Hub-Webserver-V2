const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
    {
        reviewType: {
            type: String,
            enum: ["user"],
            required: true,
        },
        object: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: "reviewType", 
            required: true,
        },
        subject: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User", // Reference to the User who wrote the review
            required: true,
        },
        rating: {
            type: Number,
            min: 1,
            max: 5, // Rating should be between 1 and 5
            required: true,
        },
        comment: {
            type: String,
            trim: true,
            default: "",
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
        updatedAt: {
            type: Date,
        },
    },
    {
        timestamps: true,
    }
);

reviewSchema.index({ reviewType: 1, rating: -1 });

const Review = mongoose.model("Review", reviewSchema);

module.exports = Review;
