const mongoose = require("mongoose");

const actionApprovalSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true
        },

        risk: {
            type: String,
            enum: ["Low", "Medium", "High", "Critical"],
            default: "Low"
        },

        requiresApproval: {
            type: Boolean,
            default: false
        },

        approved: {
            type: Boolean,
            default: false
        },

        status: {
            type: String,
            enum: [
                "Pending",
                "Ready",
                "Approved",
                "Executed",
                "Verified"
            ],
            default: "Pending"
        }
    },
    {
        _id: true
    }
);


const actionSchema = new mongoose.Schema({

    task: {
        type: String,
        required: true
    },

    plan: {
        type: String,
        required: true
    },

    // Individual actions detected by Intent Engine
    actions: {
        type: [actionApprovalSchema],
        default: []
    },

    status: {
        type: String,
        default: "Planned"
    },

    // Overall approval status
    approved: {
        type: Boolean,
        default: false
    },

    createdAt: {
        type: Date,
        default: Date.now
    }

});


module.exports =
    mongoose.model("Action", actionSchema);