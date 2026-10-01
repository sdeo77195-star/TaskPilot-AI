const mongoose = require("mongoose");

const intentSchema = new mongoose.Schema({
    task: {
        type: String,
        required: true
    },

    intent: {
        type: String,
        required: true
    },

    actions: [
        {
            name: String,
            risk: {
                type: String,
                enum: ["Low", "Medium", "High", "Critical"],
                default: "Low"
            },
            requiresApproval: {
                type: Boolean,
                default: false
            }
        }
    ],

    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Intent", intentSchema);