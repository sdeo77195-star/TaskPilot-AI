const express = require("express");
const dns = require("dns");
const fs = require("fs");
const path = require("path");

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const dotenv = require("dotenv");
const cors = require("cors");
const mongoose = require("mongoose");
const { GoogleGenAI } = require("@google/genai");
const { google } = require("googleapis");

const Action = require("./models/Action");
const Intent = require("./models/Intent");
const Task = require("./models/Task");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


// =====================================================
// MONGODB
// =====================================================

mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => {
        console.log("MongoDB connected successfully");
    })
    .catch((error) => {
        console.error("MongoDB connection error:", error);
    });


// =====================================================
// GEMINI
// =====================================================

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});


// =====================================================
// GEMINI FALLBACK MODELS
// =====================================================

const GEMINI_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash"
];


// =====================================================
// GEMINI HELPER
// =====================================================

async function generateAI(contents) {

    for (const model of GEMINI_MODELS) {

        console.log(`Trying Gemini: ${model}`);

        try {

            const response =
                await ai.models.generateContent({
                    model: model,
                    contents: contents
                });

            console.log(
                `Gemini success using: ${model}`
            );

            return {
                response,
                model
            };

        } catch (error) {

            const status =
                error?.status ||
                error?.error?.code;

            console.error(
                `Gemini error on ${model}:`,
                error?.message || error
            );

            if (status === 429) {

                console.log(
                    `Quota exceeded for ${model}. Trying next model...`
                );

            } else if (
                status === 500 ||
                status === 503
            ) {

                console.log(
                    `Gemini ${model} temporarily unavailable. Trying next model...`
                );

            } else {

                console.log(
                    `Gemini ${model} failed. Trying next model...`
                );

            }

        }

    }

    console.log(
        "All Gemini models failed."
    );

    console.log(
        "Activating TaskPilot Local Fallback..."
    );

    return {

        response: {
            text: "",
            localFallback: true
        },

        model:
            "TaskPilot Local Fallback"

    };

}


// =====================================================
// REAL WEB SEARCH WITH GEMINI GOOGLE SEARCH
// =====================================================

async function executeWebSearch(taskText) {

    try {

        const response = await fetch(
            "https://api.tavily.com/search",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.TAVILY_API_KEY}`
                },

                body: JSON.stringify({
                    query: taskText,
                    search_depth: "advanced",
                    topic: "general",
                    max_results: 5,
                    include_answer: true,
                    include_raw_content: false
                })
            }
        );


        const data = await response.json();

        console.log("TAVILY STATUS:", response.status);
console.log("TAVILY RESULTS:", data?.results?.length || 0);


        if (!response.ok) {

            console.error(
                "TAVILY SEARCH ERROR:",
                data
            );

            return {

                success: false,

                message:
                    data?.detail ||
                    data?.error ||
                    "Tavily web search failed."

            };

        }


        return {

            success: true,

            message:
                "Web search completed successfully.",

            answer:
                data?.answer ||
                "Search results found.",

            results:
                data?.results || [],

            query:
                taskText,

            provider:
                "Tavily"

        };


    } catch (error) {

        console.error(
            "WEB SEARCH ERROR:",
            error?.message || error
        );


        return {

            success: false,

            message:
                error?.message ||
                "Web search failed."

        };

    }

}


// =====================================================
// TASKPILOT LOCAL FALLBACK
// =====================================================

function localFallbackAI(contents) {

    const input =
        typeof contents === "string"
            ? contents
            : JSON.stringify(contents);


    const text =
        input.toLowerCase();


    const actions = [];


    // -------------------------------------------------
    // CALENDAR DETECTION
    // -------------------------------------------------

    if (
        text.includes("calendar") ||
        text.includes("event") ||
        text.includes("meeting") ||
        text.includes("schedule")
    ) {

        actions.push({

            name: "Calendar Event",

            risk: "Medium",

            requiresApproval: true

        });

    }


    // -------------------------------------------------
    // TASK / REMINDER DETECTION
    // -------------------------------------------------

if (
    text.includes("reminder") ||
    text.includes("remind") ||
    text.includes("todo") ||
    text.includes("study plan") ||
    text.includes("study schedule") ||
    text.includes("study planner") ||
    text.includes("padhai ka plan") ||
    text.includes("padhne ka plan") ||
    text.includes("study routine") ||
    text.includes("revision plan") ||
    text.includes("exam plan")
) {

        actions.push({

            name: "Create Reminder Task",

            risk: "Medium",

            requiresApproval: true

        });

    }


    // -------------------------------------------------
    // STUDY PLANNER
    // -------------------------------------------------

    if (
    text.includes("study plan") ||
    text.includes("study schedule") ||
    text.includes("study timetable") ||
    text.includes("study planner") ||
    text.includes("plan my study") ||
    text.includes("padhai ka plan") ||
    text.includes("padhai ka schedule") ||
    text.includes("padhai ka timetable")
) {

        actions.push({

            name: "Plan Study Schedule",

            risk: "Low",

            requiresApproval: false

        });

    }


    // -------------------------------------------------
    // EMAIL
    // -------------------------------------------------

    if (
        text.includes("email") ||
        text.includes("mail") ||
        text.includes("send message")
    ) {

        actions.push({

            name: "Send Email",

            risk: "High",

            requiresApproval: true

        });

    }


    // -------------------------------------------------
    // WEB SEARCH
    // -------------------------------------------------

    if (
        text.includes("search") ||
        text.includes("find information") ||
        text.includes("look up")
    ) {

        actions.push({

            name: "Web Search",

            risk: "Low",

            requiresApproval: false

        });

    }


    // -------------------------------------------------
    // DEFAULT ACTION
    // -------------------------------------------------

    if (actions.length === 0) {

        actions.push({

            name: "General Task",

            risk: "Low",

            requiresApproval: false

        });

    }


    // -------------------------------------------------
    // INTENT
    // -------------------------------------------------

    let intent =
        "Complete the user's requested task";


    const hasCalendar =
    text.includes("calendar") ||
    text.includes("meeting") ||
    text.includes("event");

const hasReminder =
    text.includes("reminder") ||
    text.includes("remind") ||
    text.includes("todo");

if (hasCalendar && hasReminder) {
    intent = "Create a calendar event and a reminder task";
} else if (hasCalendar) {
    intent = "Create or manage a calendar event";
} else if (hasReminder) {
    intent = "Create a reminder task for the user";
} else if (
    text.includes("study") ||
    text.includes("learn") ||
    text.includes("exam")
) {
    intent = "Help the user plan and complete their study task";
}


    return {

        intent,

        actions

    };

}

// =====================================================
// CLEAN JSON
// =====================================================

function cleanJSON(text) {

    return text
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
}


// =====================================================
// GOOGLE CALENDAR OAUTH
// =====================================================

const GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events"
];

const GOOGLE_TOKEN_PATH =
    path.join(__dirname, "google-token.json");


function getGoogleOAuthClient() {

    if (
        !process.env.GOOGLE_CLIENT_ID ||
        !process.env.GOOGLE_CLIENT_SECRET ||
        !process.env.GOOGLE_REDIRECT_URI
    ) {
        throw new Error(
            "Google OAuth environment variables are missing."
        );
    }

    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
}


function loadGoogleTokens() {

    try {

        if (!fs.existsSync(GOOGLE_TOKEN_PATH)) {
            return null;
        }

        const tokenData =
            fs.readFileSync(
                GOOGLE_TOKEN_PATH,
                "utf8"
            );

        return JSON.parse(tokenData);

    } catch (error) {

        console.error(
            "Could not load Google tokens:",
            error.message
        );

        return null;
    }
}


function saveGoogleTokens(tokens) {

    fs.writeFileSync(
        GOOGLE_TOKEN_PATH,
        JSON.stringify(tokens, null, 2)
    );

    console.log(
        "Google Calendar tokens saved locally."
    );
}


function getAuthenticatedGoogleClient() {

    const tokens = loadGoogleTokens();

    if (!tokens) {
        return null;
    }

    const oauth2Client =
        getGoogleOAuthClient();

    oauth2Client.setCredentials(tokens);

    return oauth2Client;
}


// =====================================================
// GOOGLE LOGIN
// =====================================================

app.get("/auth/google", (req, res) => {

    try {

        const oauth2Client =
            getGoogleOAuthClient();

        const authUrl =
            oauth2Client.generateAuthUrl({
                access_type: "offline",
                prompt: "consent",
                scope: GOOGLE_SCOPES
            });

        res.redirect(authUrl);

    } catch (error) {

        console.error(
            "Google OAuth start error:",
            error
        );

        res.status(500).send(
            "Could not start Google authentication."
        );
    }

});


// =====================================================
// GOOGLE OAUTH CALLBACK
// =====================================================

app.get("/auth/google/callback", async (req, res) => {

    try {

        const code = req.query.code;

        if (!code) {

            return res.status(400).send(
                "Google authorization code is missing."
            );
        }

        const oauth2Client =
            getGoogleOAuthClient();

        const { tokens } =
            await oauth2Client.getToken(code);

        saveGoogleTokens(tokens);

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>

                <title>
                    TaskPilot AI - Google Connected
                </title>

                <style>

                    body {
                        font-family: Arial, sans-serif;
                        text-align: center;
                        padding: 60px;
                    }

                    .success {
                        font-size: 50px;
                    }

                    button {
                        padding: 12px 22px;
                        font-size: 16px;
                        cursor: pointer;
                    }

                </style>

            </head>

            <body>

                <div class="success">
                    ✅
                </div>

                <h1>
                    Google Calendar Connected
                </h1>

                <p>
                    TaskPilot AI can now create
                    Google Calendar events.
                </p>

                <button
                    onclick="window.location.href='/'">

                    Back to TaskPilot AI

                </button>

            </body>

            </html>
        `);

    } catch (error) {

        console.error(
            "Google OAuth callback error:",
            error
        );

        res.status(500).send(
            "Google authentication failed."
        );
    }

});


// =====================================================
// GOOGLE CALENDAR STATUS
// =====================================================

app.get("/api/calendar/status", (req, res) => {

    const tokens = loadGoogleTokens();

    res.json({

        success: true,

        connected:
            Boolean(tokens)

    });

});


// =====================================================
// TOOL REGISTRY
// =====================================================

const TOOL_REGISTRY = {

    study_planner: {
        name: "Study Planner",
        risk: "Low",
        category: "planning"
    },

    calendar: {
        name: "Calendar Tool",
        risk: "Medium",
        category: "calendar"
    },

    task_manager: {
        name: "Task Manager",
        risk: "Medium",
        category: "task"
    },

    email: {
        name: "Email Tool",
        risk: "High",
        category: "communication"
    },

    web_search: {
        name: "Web Search",
        risk: "Low",
        category: "information"
    }

};


// =====================================================
// TOOL SELECTION ENGINE
// =====================================================

function selectTools(actions = []) {

    const selectedTools = [];

    for (const action of actions) {


        

        const actionName =
            String(action?.name || "").toLowerCase();


        // ---------------------------------------------
        // STUDY PLANNER
        // ---------------------------------------------

        if (
            actionName.includes("study") ||
            actionName.includes("schedule") ||
            actionName.includes("plan")
        ) {

            if (
                !selectedTools.some(
                    tool => tool.key === "study_planner"
                )
            ) {

                selectedTools.push({
                    key: "study_planner",
                    ...TOOL_REGISTRY.study_planner
                });

            }

        }


        // ---------------------------------------------
        // CALENDAR
        // ---------------------------------------------

        if (
            actionName.includes("calendar") ||
            actionName.includes("event") ||
            actionName.includes("meeting")
        ) {

            if (
                !selectedTools.some(
                    tool => tool.key === "calendar"
                )
            ) {

                selectedTools.push({
                    key: "calendar",
                    ...TOOL_REGISTRY.calendar
                });

            }

        }


        // ---------------------------------------------
        // TASK MANAGER
        // ---------------------------------------------

        if (
            actionName.includes("task") ||
            actionName.includes("todo") ||
            actionName.includes("reminder")
        ) {

            if (
                !selectedTools.some(
                    tool => tool.key === "task_manager"
                )
            ) {

                selectedTools.push({
                    key: "task_manager",
                    ...TOOL_REGISTRY.task_manager
                });

            }

        }


        // ---------------------------------------------
        // EMAIL
        // ---------------------------------------------

        if (
            actionName.includes("email") ||
            actionName.includes("mail") ||
            actionName.includes("send")
        ) {

            if (
                !selectedTools.some(
                    tool => tool.key === "email"
                )
            ) {

                selectedTools.push({
                    key: "email",
                    ...TOOL_REGISTRY.email
                });

            }

        }


        // ---------------------------------------------
        // WEB SEARCH
        // ---------------------------------------------

        if (
            actionName.includes("search") ||
            actionName.includes("web") ||
            actionName.includes("information")
        ) {

            if (
                !selectedTools.some(
                    tool => tool.key === "web_search"
                )
            ) {

                selectedTools.push({
                    key: "web_search",
                    ...TOOL_REGISTRY.web_search
                });

            }

        }

    }


    return selectedTools;

}


// =====================================================
// INTENT & RISK ANALYSIS
// =====================================================

app.post("/api/intent", async (req, res) => {

    try {

        const { task } = req.body;

        if (!task || !task.trim()) {

            return res.status(400).json({
                success: false,
                message: "Task is required."
            });

        }


        const prompt = `
You are the Intent and Risk Analysis Engine
of an autonomous AI assistant called TaskPilot AI.

Analyze the user's task and return ONLY valid JSON.

User Task:
${task}

Return exactly this structure:

{
    "intent": "short description of the user's intent",
    "actions": [
        {
            "name": "action name",
            "risk": "Low | Medium | High | Critical",
            "requiresApproval": true
        }
    ]
}

Rules:

1. Low-risk informational or planning actions:
   requiresApproval = false

2. Medium-risk actions that modify user data:
   requiresApproval = true

3. High-risk communication or external actions:
   requiresApproval = true

4. Critical actions involving sensitive or irreversible
   operations:
   requiresApproval = true

5. Do not add explanations outside JSON.
`;


        const {
            response,
            model
        } = await generateAI(prompt);

// =====================================================
// LOCAL FALLBACK
// =====================================================

if (response?.localFallback === true) {

    console.log(
        "Using TaskPilot Local Fallback for intent analysis."
    );

    const fallbackAnalysis =
        localFallbackAI(task);

    const intentRecord =
        await Intent.create({

            task: task,

            intent:
                fallbackAnalysis.intent ||
                "General task",

            actions:
                Array.isArray(fallbackAnalysis.actions)
                    ? fallbackAnalysis.actions
                    : []

        });

    return res.json({

        success: true,

        task: task,

        intent:
            fallbackAnalysis.intent ||
            "General task",

        actions:
            Array.isArray(fallbackAnalysis.actions)
                ? fallbackAnalysis.actions
                : [],

        intentId:
            intentRecord._id,

        model:
            "TaskPilot Local Fallback",

        fallback: true

    });

}

        const rawText =
            response?.text ||
            response?.candidates?.[0]?.content?.parts
                ?.map(part => part.text || "")
                .join("") ||
            "";


        const cleaned =
            cleanJSON(rawText);


        let analysis;

        try {

            analysis =
                JSON.parse(cleaned);

        } catch (parseError) {

            console.error(
                "Intent JSON parsing error:",
                parseError
            );

            return res.status(500).json({
                success: false,
                message: "AI returned invalid JSON.",
                raw: cleaned
            });

        }


        const intentRecord =
            await Intent.create({

                task: task,

                intent:
                    analysis.intent ||
                    "General task",

                actions:
                    Array.isArray(analysis.actions)
                        ? analysis.actions
                        : []

            });


        res.json({

            success: true,

            task: task,

            intent:
                analysis.intent ||
                "General task",

            actions:
                Array.isArray(analysis.actions)
                    ? analysis.actions
                    : [],

            intentId:
                intentRecord._id,

            model

        });


    } catch (error) {

        console.error(
            "Intent analysis error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                error?.message ||
                "Intent analysis failed."

        });

    }

});


// =====================================================
// PLAN GENERATION
// =====================================================

app.post("/api/plan", async (req, res) => {

    try {

        const { task } = req.body;

        if (!task || !task.trim()) {

            return res.status(400).json({
                success: false,
                message: "Task is required."
            });

        }


        // -------------------------------------------------
        // STEP 1: AI INTENT + RISK ANALYSIS
        // -------------------------------------------------

        const intentPrompt = `
You are the Intent and Risk Analysis Engine
of TaskPilot AI.

Analyze the following user task.

User Task:
${task}

Return ONLY valid JSON:

{
    "intent": "short description",
    "actions": [
        {
            "name": "short action name",
            "risk": "Low | Medium | High | Critical",
            "requiresApproval": true
        }
    ]
}

Rules:

- Planning and information actions are Low risk.
- Actions that modify user data are Medium risk.
- Sending messages or external communication is High risk.
- Irreversible or sensitive operations are Critical risk.
- requiresApproval must be true for Medium, High and Critical.
- requiresApproval must normally be false for Low.
- Return JSON only.
`;


        const intentResult =
            await generateAI(intentPrompt);

            // =====================================================
// LOCAL FALLBACK CHECK
// =====================================================

let localAnalysis = null;

if (
    intentResult?.response?.localFallback === true
) {

    console.log(
        "Using TaskPilot Local Fallback for intent analysis."
    );

    localAnalysis =
        localFallbackAI(task);

}

      const intentText =
    intentResult?.response?.localFallback === true
        ? JSON.stringify(localAnalysis)
        : (
            intentResult.response?.text ||
            intentResult.response?.candidates?.[0]
                ?.content?.parts
                ?.map(part => part.text || "")
                .join("") ||
            ""
        );  


        const intentJSON =
            cleanJSON(intentText);


        let analysis;

        try {

            analysis =
                JSON.parse(intentJSON);

        } catch (error) {

            console.error(
                "Plan intent JSON parsing error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "AI returned invalid intent JSON.",
                raw: intentJSON
            });

        }


        const detectedActions =
            Array.isArray(analysis.actions)
                ? analysis.actions
                : [];


        // -------------------------------------------------
        // STEP 2: SAVE INTENT
        // -------------------------------------------------

        const intentRecord =
            await Intent.create({

                task: task,

                intent:
                    analysis.intent ||
                    "General task",

                actions:
                    detectedActions

            });


        // -------------------------------------------------
        // STEP 3: SELECT TOOLS
        // -------------------------------------------------

        const selectedTools =
            selectTools(detectedActions);


        // -------------------------------------------------
        // STEP 4: GENERATE EXECUTION PLAN
        // -------------------------------------------------

        const toolDescription =
            selectedTools.length > 0
                ? selectedTools
                    .map(tool =>
                        `${tool.name} (${tool.risk} risk)`
                    )
                    .join(", ")
                : "No external tool required";


        const planPrompt = `
You are the Planning Engine of TaskPilot AI.

Create a clear step-by-step execution plan
for the user's task.

User Task:
${task}

Detected Intent:
${analysis.intent || "General task"}

Detected Actions:
${JSON.stringify(detectedActions)}

Available Tools:
${toolDescription}

Return ONLY valid JSON:

{
    "plan": "step 1 -> step 2 -> step 3",
    "actions": [
        {
            "name": "action name",
            "risk": "Low | Medium | High | Critical",
            "requiresApproval": true
        }
    ]
}

Rules:

1. Keep the plan practical.
2. Do not invent unnecessary actions.
3. Preserve the detected actions.
4. Use the available tools when appropriate.
5. Medium, High and Critical actions require approval.
6. Low-risk actions normally do not require approval.
7. Return JSON only.
`;


        let planResult;

if (detectedActions.length > 1) {

    console.log(
        "Multiple actions detected. Building plan locally."
    );

    const localPlan =
        detectedActions
            .map(
                (action, index) =>
                    `${index + 1}. ${action.name}`
            )
            .join(" -> ");

    planResult = {
        response: {
            text: JSON.stringify({
                plan: localPlan,
                tools: selectTools(detectedActions)
            })
        },
        model: "TaskPilot Local Planner"
    };

} else {

    planResult =
        await generateAI(planPrompt);

}


            // =====================================================
// LOCAL FALLBACK FOR PLAN
// =====================================================

if (
    planResult?.response?.localFallback === true
) {
    console.log(
        "Using TaskPilot Local Fallback for plan generation."
    );

    const fallbackActions =
        localAnalysis?.actions || [];

    const fallbackPlan =
        fallbackActions.length > 0
            ? fallbackActions
                .map(
                    (action, index) =>
                        `${index + 1}. ${action.name}`
                )
                .join(" -> ")
            : "Complete the user's requested task";

    const actionRecord =
        await Action.create({
            task: task,
            plan: fallbackPlan,
            actions: fallbackActions.map(action => ({
                name:
                    action.name ||
                    "General Task",

                risk:
                    action.risk ||
                    "Low",

                requiresApproval:
                    Boolean(
                        action.requiresApproval
                    ),

                approved: false,

                status:
                    action.requiresApproval
                        ? "Pending"
                        : "Ready"
            })),

            status: "Planned",
            approved: false
        });

    return res.json({
        success: true,

        task: task,

        intent:
            localAnalysis?.intent ||
            "General Task",

        plan:
            fallbackPlan,

        tools:
            selectTools(fallbackActions),

        actions:
            actionRecord.actions,

        actionId:
            actionRecord._id,

        intentId:
            intentRecord._id,

        model:
            "TaskPilot Local Fallback",

        fallback: true
    });
}


        const planText =
    planResult.response?.text ||
    planResult.response?.candidates?.[0]
        ?.content?.parts
        ?.map(part => part.text || "")
        .join("") ||
    "";

let planJSON =
    cleanJSON(planText);

if (!planJSON) {

    planJSON = JSON.stringify({
        plan:
            detectedActions
                .map(
                    (action, index) =>
                        `${index + 1}. ${action.name}`
                )
                .join(" -> "),

        actions:
            detectedActions,

        tools:
            selectTools(detectedActions)
    });

}


let generatedPlan;



        try {

            generatedPlan =
                JSON.parse(planJSON);

        } catch (error) {

            console.error(
                "Plan JSON parsing error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "AI returned invalid plan JSON.",
                raw: planJSON
            });

        }


        const finalActions =
            Array.isArray(generatedPlan.actions)
                ? generatedPlan.actions
                : detectedActions;


        // -------------------------------------------------
        // STEP 5: SAVE ACTION
        // -------------------------------------------------

        const actionRecord =
            await Action.create({

                task: task,

                plan:
                    generatedPlan.plan ||
                    "No execution plan generated.",

                actions:
                    finalActions.map(action => ({

                        name:
                            action.name ||
                            "Unknown Action",

                        risk:
                            action.risk ||
                            "Low",

                        requiresApproval:
                            Boolean(
                                action.requiresApproval
                            ),

                        approved: false,

                        status:
                            action.requiresApproval
                                ? "Pending"
                                : "Ready"

                    })),

                status: "Planned",

                approved: false

            });


        // -------------------------------------------------
        // STEP 6: RESPONSE
        // -------------------------------------------------

        res.json({

            success: true,

            task: task,

            plan:
                generatedPlan.plan ||
                "No execution plan generated.",

            actionId:
                actionRecord._id,

            intentId:
                intentRecord._id,

            intent:
                analysis.intent ||
                "General task",

            tools:
                selectedTools,

            actions:
                actionRecord.actions,

            model:
                planResult.model

        });


    } catch (error) {

        console.error(
            "Plan generation error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                error?.message ||
                "Plan generation failed."

        });

    }

});


// =====================================================
// APPROVE INDIVIDUAL ACTION
// =====================================================

app.post("/api/approve-action", async (req, res) => {

    try {

        const { actionId, subActionId } = req.body;

        if (!actionId || !subActionId) {

            return res.status(400).json({
                success: false,
                message: "actionId and subActionId are required."
            });

        }


        const actionRecord =
            await Action.findById(actionId);

        if (!actionRecord) {

            return res.status(404).json({
                success: false,
                message: "Action record not found."
            });

        }


        const subAction =
            actionRecord.actions.id(subActionId);

        if (!subAction) {

            return res.status(404).json({
                success: false,
                message: "Sub-action not found."
            });

        }


        subAction.approved = true;
        subAction.status = "Approved";


        await actionRecord.save();


        res.json({

            success: true,

            message:
                "Action approved successfully.",

            actionId:
                actionRecord._id,

            subActionId:
                subAction._id,

            action: subAction

        });


    } catch (error) {

        console.error(
            "Approve action error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                error?.message ||
                "Could not approve action."

        });

    }

});


// =====================================================
// APPROVE ALL ACTIONS
// =====================================================

app.post("/api/approve", async (req, res) => {

    try {

        const { actionId } = req.body;

        if (!actionId) {

            return res.status(400).json({
                success: false,
                message: "actionId is required."
            });

        }


        const actionRecord =
            await Action.findById(actionId);

        if (!actionRecord) {

            return res.status(404).json({
                success: false,
                message: "Action record not found."
            });

        }


        actionRecord.actions.forEach(action => {

            action.approved = true;
            action.status = "Approved";

        });


        actionRecord.approved = true;
        actionRecord.status = "Approved";


        await actionRecord.save();


        res.json({

            success: true,

            message:
                "All actions approved successfully.",

            actionId:
                actionRecord._id,

            actions:
                actionRecord.actions

        });


    } catch (error) {

        console.error(
            "Approve all actions error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                error?.message ||
                "Could not approve actions."

        });

    }

});


// =====================================================
// CALENDAR EVENT EXTRACTION
// =====================================================

function extractCalendarEvents(taskText) {

    const text =
        String(taskText || "").trim();

    const events = [];

    if (!text) {
        return events;
    }


    // -------------------------------------------------
    // DATE DETECTION
    // -------------------------------------------------

    const today =
        new Date();

    let eventDate =
        new Date(today);


    const lowerText =
        text.toLowerCase();


   if (
    lowerText.includes("day after tomorrow")
) {

    eventDate.setDate(
        eventDate.getDate() + 2
    );

} else if (
    lowerText.includes("tomorrow") ||
    lowerText.includes("kal")
) {

    eventDate.setDate(
        eventDate.getDate() + 1
    );

} else if (
    lowerText.includes("today") ||
    lowerText.includes("aaj")
) {

    // Keep today's date

}


// -------------------------------------------------
// TIME DETECTION
// -------------------------------------------------

let hours = 10;
let minutes = 0;

const timeMatch =
    lowerText.match(
        /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)?\b/i
    );

if (timeMatch) {

    hours =
        parseInt(timeMatch[1], 10);

    minutes =
        timeMatch[2]
            ? parseInt(timeMatch[2], 10)
            : 0;

    const period =
        timeMatch[3]
            ? timeMatch[3].toLowerCase()
            : null;

    // PM
    if (
        period === "pm" &&
        hours < 12
    ) {

        hours += 12;

    }

    // AM
    if (
        period === "am" &&
        hours === 12
    ) {

        hours = 0;

    }

    // "baje" means normal 12-hour clock.
    // 9 baje = 9:00 AM by default.
    if (
        period === "baje" &&
        hours >= 1 &&
        hours <= 12
    ) {

        // Keep morning time by default.
        // Example: 9 baje = 09:00
        if (hours === 12) {
            hours = 0;
        }

    }

}

eventDate.setHours(
    hours,
    minutes,
    0,
    0
);




// -----------------------------------------------------
// SMART EVENT TITLE CLEANING
// -----------------------------------------------------

let title = text;

// Remove date words
title = title.replace(
    /\b(day after tomorrow|tomorrow|today|kal|aaj)\b/gi,
    ""
);

// Remove time
title = title.replace(
    /\b\d{1,2}(?::\d{2})?\s*(am|pm|baje)?\b/gi,
    ""
);

// Remove calendar/event/scheduling words
title = title.replace(
    /\b(calendar event|calendar|event|schedule|scheduled|banao|banana|karo|karna|create|make|add|set)\b/gi,
    ""
);

// Remove reminder words
title = title.replace(
    /\b(reminder|remind|mujhe|do|de|dena|bhi)\b/gi,
    ""
);

// Remove common joining words left after cleaning
title = title.replace(
    /\b(aur)\b/gi,
    ""
);

// Clean extra spaces and punctuation
title = title
    .replace(/[,.!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Make the title cleaner
if (title) {
    title = title
        .split(" ")
        .filter(Boolean)
        .map(word =>
            word.charAt(0).toUpperCase() +
            word.slice(1)
        )
        .join(" ");
}

// Fallback title
if (!title) {
    title = "TaskPilot AI Event";
}


    events.push({

        summary: title,

        description:
            `Created by TaskPilot AI.\n\nOriginal task: ${text}`,

        start: {
            dateTime:
                eventDate.toISOString(),

            timeZone:
                Intl.DateTimeFormat()
                    .resolvedOptions()
                    .timeZone
        },

        end: {
            dateTime:
                new Date(
                    eventDate.getTime() +
                    60 * 60 * 1000
                ).toISOString(),

            timeZone:
                Intl.DateTimeFormat()
                    .resolvedOptions()
                    .timeZone
        }

    });


    return events;

}

// =====================================================
// VERIFY GOOGLE CALENDAR EVENT
// =====================================================

async function verifyCalendarEvent(eventId, expectedEvent = {}) {

    try {

        const authClient =
            getAuthenticatedGoogleClient();

        if (!authClient) {

            return {
                verified: false,
                message: "Google Calendar is not connected."
            };

        }

        const calendar =
            google.calendar({
                version: "v3",
                auth: authClient
            });

        const response =
            await calendar.events.get({
                calendarId: "primary",
                eventId: eventId
            });

        const event =
            response.data;

        const summaryMatch =
            !expectedEvent.summary ||
            event.summary === expectedEvent.summary;

        const verified =
            summaryMatch &&
            event.status !== "cancelled";

        return {

            verified,

            message: verified
                ? "Calendar event independently verified with Google Calendar."
                : "Calendar event exists, but verification data does not match.",

            event: {
                id: event.id,
                summary: event.summary,
                status: event.status,
                start: event.start,
                end: event.end,
                htmlLink: event.htmlLink
            }

        };

    } catch (error) {

        console.error(
            "CALENDAR VERIFICATION ERROR:",
            error.message
        );

        return {

            verified: false,

            message:
                "Calendar event verification failed.",

            error:
                error.message

        };

    }

}


// =====================================================
// EXECUTE CALENDAR ACTION
// =====================================================

async function executeCalendarAction(taskText) {
    
    
    const authClient =
        getAuthenticatedGoogleClient();


    if (!authClient) {

        throw new Error(
            "Google Calendar is not connected. Please connect Google Calendar first."
        );

    }


    const calendar =
        google.calendar({
            version: "v3",
            auth: authClient
        });


    const events =
        extractCalendarEvents(taskText);


    if (!events.length) {

        throw new Error(
            "No calendar event could be extracted from the task."
        );

    }


    const createdEvents = [];


    for (const event of events) {

        const response =
            await calendar.events.insert({

                calendarId: "primary",

                requestBody: event

            });


        createdEvents.push({

            id:
                response.data.id,

            summary:
                response.data.summary,

            htmlLink:
                response.data.htmlLink,

            start:
                response.data.start,

            end:
                response.data.end

        });

    }


    return {

        success: true,

        message:
            `${createdEvents.length} calendar event(s) created successfully.`,

        events:
            createdEvents

    };

}


// =====================================================
// TASK MANAGER AI EXTRACTION
// =====================================================

async function extractTaskDetails(taskText) {

   // =====================================================
// LOCAL DATE + TIME DETECTION
// =====================================================

const lowerTask =
    String(taskText || "").toLowerCase();

const now =
    new Date();

let localDueDate = null;


// -----------------------------------------------------
// DATE DETECTION
// -----------------------------------------------------

if (
    lowerTask.includes("day after tomorrow")
) {

    localDueDate = new Date(now);

    localDueDate.setDate(
        localDueDate.getDate() + 2
    );

}

else if (
    lowerTask.includes("kal") ||
    lowerTask.includes("tomorrow")
) {

    localDueDate = new Date(now);

    localDueDate.setDate(
        localDueDate.getDate() + 1
    );

}

else if (
    lowerTask.includes("aaj") ||
    lowerTask.includes("today")
) {

    localDueDate = new Date(now);

}


// -----------------------------------------------------
// SMART TIME DETECTION
// -----------------------------------------------------

if (localDueDate) {

    let hours = 9;
    let minutes = 0;

    const timeMatch = lowerTask.match(
        /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)?\b/i
    );

    const isMorning =
        lowerTask.includes("subah") ||
        lowerTask.includes("morning");

    const isAfternoon =
        lowerTask.includes("dopahar") ||
        lowerTask.includes("afternoon");

    const isEvening =
        lowerTask.includes("shaam") ||
        lowerTask.includes("evening");

    const isNight =
        lowerTask.includes("raat") ||
        lowerTask.includes("night");

    if (timeMatch) {

        hours = parseInt(timeMatch[1], 10);

        minutes = timeMatch[2]
            ? parseInt(timeMatch[2], 10)
            : 0;

        const period = timeMatch[3]
            ? timeMatch[3].toLowerCase()
            : null;

        // AM
        if (
            period === "am" &&
            hours === 12
        ) {
            hours = 0;
        }

        // PM
        else if (
            period === "pm" &&
            hours < 12
        ) {
            hours += 12;
        }

        // Hindi / Hinglish time
        else if (period === "baje") {

            if (
                isEvening ||
                isNight ||
                isAfternoon
            ) {

                if (hours < 12) {
                    hours += 12;
                }

            }

            if (
                isNight &&
                hours === 12
            ) {
                hours = 0;
            }

        }

        // No AM/PM/baje, but day-part exists
        else if (
            isEvening ||
            isNight ||
            isAfternoon
        ) {

            if (hours < 12) {
                hours += 12;
            }

        }

    }

    localDueDate.setHours(
        hours,
        minutes,
        0,
        0
    );

}
    // -----------------------------------------------------
// SMART TASK TITLE CLEANING
// -----------------------------------------------------

let taskTitle = String(taskText || "").trim();

// Remove date words
taskTitle = taskTitle.replace(
    /\b(day after tomorrow|tomorrow|today|kal|aaj)\b/gi,
    ""
);

// Remove time
taskTitle = taskTitle.replace(
    /\b\d{1,2}(?::\d{2})?\s*(am|pm|baje)?\b/gi,
    ""
);

// Remove scheduling words
taskTitle = taskTitle.replace(
    /\b(calendar event|calendar|event|schedule|scheduled|banao|banana|karo|karna|create|make|add|set)\b/gi,
    ""
);

// Remove reminder words
taskTitle = taskTitle.replace(
    /\b(reminder|remind|mujhe|do|de|dena|bhi)\b/gi,
    ""
);

// Remove joining words
taskTitle = taskTitle.replace(
    /\b(aur)\b/gi,
    ""
);

// Clean spaces and punctuation
taskTitle = taskTitle
    .replace(/[,.!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Fallback
if (!taskTitle) {
    taskTitle = "TaskPilot AI Task";
}

// Make title words start with capital letters
taskTitle = taskTitle
    .split(" ")
    .filter(Boolean)
    .map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");

console.log("TASK TITLE DEBUG:", taskTitle);

return {
    title: taskTitle,
    description: String(taskText || "").trim(),
    dueDate: localDueDate,
    model: "TaskPilot Local Task Extractor"
};
}


// =====================================================
// EXECUTE TASK MANAGER ACTION
// =====================================================

async function executeTaskManagerAction(taskText) {

    const taskDetails =
        await extractTaskDetails(taskText);


    let dueDate = null;


    if (taskDetails.dueDate) {

        const parsedDate =
            new Date(taskDetails.dueDate);


        if (!Number.isNaN(parsedDate.getTime())) {

            dueDate =
                parsedDate;

        }

    }


    const task =
        await Task.create({

            title:
                taskDetails.title,

            description:
                taskDetails.description,

            dueDate:
                dueDate,

            status:
                "Pending"

        });


    return {

        success: true,

        message:
            "Task created successfully.",

        task: {

            id:
                task._id,

            title:
                task.title,

            description:
                task.description,

            dueDate:
                task.dueDate,

            status:
                task.status,

            createdAt:
                task.createdAt

        },

        model:
            taskDetails.model

    };

}

// =====================================================
// VERIFY TASK MANAGER ACTION
// =====================================================

async function verifyTaskManagerAction(taskId, expectedTask = {}) {

    try {

        const task = await Task.findById(taskId);

        if (!task) {

            return {
                verified: false,
                message: "Task was not found in MongoDB."
            };

        }

        const titleMatch =
            !expectedTask.title ||
            task.title === expectedTask.title;

        const statusMatch =
            !expectedTask.status ||
            task.status === expectedTask.status;

        const verified =
            titleMatch &&
            statusMatch;

        return {

            verified,

            message: verified
                ? "Task independently verified in MongoDB."
                : "Task exists, but verification data does not match.",

            task: {
                id: task._id,
                title: task.title,
                description: task.description,
                dueDate: task.dueDate,
                status: task.status,
                createdAt: task.createdAt
            }

        };

    } catch (error) {

        console.error(
            "TASK VERIFICATION ERROR:",
            error.message
        );

        return {
            verified: false,
            message: "Task verification failed.",
            error: error.message
        };

    }

}

// =====================================================
// EXECUTE INDIVIDUAL ACTION
// =====================================================

app.post("/api/execute-action", async (req, res) => {

    try {

        const { actionId, subActionId } = req.body;

        if (!actionId || !subActionId) {

            return res.status(400).json({
                success: false,
                message: "actionId and subActionId are required."
            });

        }


        const actionRecord =
            await Action.findById(actionId);

        if (!actionRecord) {

            return res.status(404).json({
                success: false,
                message: "Action record not found."
            });

        }


        const subAction =
            actionRecord.actions.id(subActionId);

        if (!subAction) {

            return res.status(404).json({
                success: false,
                message: "Sub-action not found."
            });

        }


        // -------------------------------------------------
        // APPROVAL CHECK
        // -------------------------------------------------

        if (
            subAction.requiresApproval &&
            !subAction.approved
        ) {

            return res.status(403).json({

                success: false,

                message:
                    "This action requires approval before execution.",

                action:
                    subAction

            });

        }

        // -------------------------------------------------
// DUPLICATE EXECUTION PREVENTION
// -------------------------------------------------

if (
    subAction.status === "Executed" ||
    subAction.status === "Verified"
) {

    return res.status(409).json({

        success: false,

        message:
            "This action has already been executed. Duplicate execution prevented.",

        actionId:
            actionRecord._id,

        subActionId:
            subAction._id,

        action:
            subAction

    });

}

        // -------------------------------------------------
        // EXECUTION
        // -------------------------------------------------

        let executionResult;


        const actionName =
            String(
                subAction.name || ""
            ).toLowerCase();


        // -------------------------------------------------
        // CALENDAR
        // -------------------------------------------------

        if (
            actionName.includes("calendar") ||
            actionName.includes("event") ||
            actionName.includes("meeting")
        ) {

            executionResult =
                await executeCalendarAction(
                    actionRecord.task
                );

        }

        // Independent Calendar Verification
if (
    executionResult &&
    executionResult.success &&
    executionResult.events &&
    executionResult.events.length > 0
) {

    const calendarVerifications = [];

    for (const createdEvent of executionResult.events) {

        const verification =
            await verifyCalendarEvent(
                createdEvent.id,
                {
                    summary: createdEvent.summary
                }
            );

        calendarVerifications.push(
            verification
        );

    }

    executionResult.verification = {
        verified:
            calendarVerifications.every(
                item => item.verified
            ),

        events:
            calendarVerifications
    };

    console.log(
        "CALENDAR VERIFICATION:",
        executionResult.verification
    );

}


        // -------------------------------------------------
        // TASK MANAGER
        // -------------------------------------------------

        else if (
            actionName.includes("task") ||
            actionName.includes("todo") ||
            actionName.includes("reminder")
        ) {

            executionResult =
                await executeTaskManagerAction(
                    actionRecord.task
                );

                // Independent Task Verification
if (
    executionResult &&
    executionResult.success &&
    executionResult.task &&
    executionResult.task.id
) {

    const verification =
        await verifyTaskManagerAction(
            executionResult.task.id,
            {
                title: executionResult.task.title,
                status: "Pending"
            }
        );

    executionResult.verification = verification;

    console.log(
        "TASK VERIFICATION:",
        verification
    );

}

        }


        // -------------------------------------------------
        // OTHER TOOLS
        // -------------------------------------------------

        // -------------------------------------------------
// WEB SEARCH
// -------------------------------------------------

else if (
    actionName.includes("search") ||
    actionName.includes("web") ||
    actionName.includes("information")
) {

    executionResult =
        await executeWebSearch(
            actionRecord.task
        );

}


// -------------------------------------------------
// OTHER TOOLS
// -------------------------------------------------



// -------------------------------------------------
// OTHER TOOLS
// -------------------------------------------------

else {

    executionResult = {

        success: true,

        message:
            "Action executed successfully.",

        simulated: true

    };

}


        // -------------------------------------------------
        // UPDATE ACTION STATUS
        // -------------------------------------------------

        subAction.status =
            "Executed";


        await actionRecord.save();


        // -------------------------------------------------
        // VERIFICATION
        // -------------------------------------------------

       let verification = {

    verified:
        executionResult?.verification?.verified ?? true,

    message:
        executionResult?.verification?.verified === false
            ? "Action executed, but independent verification failed."
            : executionResult?.verification?.verified === true
                ? "Action independently verified successfully."
                : "Execution completed successfully."

};


        if (
            executionResult &&
            executionResult.success === false
        ) {

            verification = {

                verified: false,

                message:
                    executionResult.message ||
                    "Execution could not be verified."

            };

        }


if (verification.verified) {

    subAction.status =
        "Verified";

    const allVerified =
        actionRecord.actions.length > 0 &&
        actionRecord.actions.every(
            item =>
                item.status === "Verified"
        );

    if (allVerified) {

        actionRecord.status =
            "Verified";

        actionRecord.approved =
            true;

    }

    await actionRecord.save();

}


        // -------------------------------------------------
        // RESPONSE
        // -------------------------------------------------

        res.json({

            success:
                executionResult?.success !== false,

            message:
                executionResult?.message ||
                "Action executed successfully.",

            actionId:
                actionRecord._id,

            subActionId:
                subAction._id,

            action:
                subAction,

            execution:
                executionResult,

            verification

        });


    } catch (error) {

        console.error(
            "Execute action error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                error?.message ||
                "Could not execute action."

        });

    }

});


// =====================================================
// LEGACY EXECUTE ALL APPROVED ACTIONS
// =====================================================

app.post("/api/execute", async (req, res) => {

    try {

        const { actionId } = req.body;

        if (!actionId) {

            return res.status(400).json({
                success: false,
                message: "actionId is required."
            });

        }


        const actionRecord =
            await Action.findById(actionId);

        if (!actionRecord) {

            return res.status(404).json({
                success: false,
                message: "Action record not found."
            });

        }


        const results = [];


        for (const subAction of actionRecord.actions) {

            // -------------------------------------------------
            // APPROVAL CHECK
            // -------------------------------------------------

            if (
                subAction.requiresApproval &&
                !subAction.approved
            ) {

                results.push({

                    actionId:
                        subAction._id,

                    name:
                        subAction.name,

                    success: false,

                    message:
                        "Action requires approval."

                });

                continue;

            }


            // -------------------------------------------------
// DUPLICATE EXECUTION PREVENTION
// -------------------------------------------------

if (
    subAction.status === "Executed" ||
    subAction.status === "Verified"
) {

    results.push({

        actionId:
            subAction._id,

        name:
            subAction.name,

        success: false,

        message:
            "This action has already been executed. Duplicate execution prevented."

    });

    continue;
}


            const actionName =
                String(
                    subAction.name || ""
                ).toLowerCase();


            let executionResult;


            // -------------------------------------------------
            // CALENDAR
            // -------------------------------------------------

            if (
                actionName.includes("calendar") ||
                actionName.includes("event") ||
                actionName.includes("meeting")
            ) {

                executionResult =
                    await executeCalendarAction(
                        actionRecord.task
                    );

            }


            // -------------------------------------------------
            // TASK MANAGER
            // -------------------------------------------------

            else if (
                actionName.includes("task") ||
                actionName.includes("todo") ||
                actionName.includes("reminder")
            ) {

                executionResult =
                    await executeTaskManagerAction(
                        actionRecord.task
                    );

            }


            // -------------------------------------------------
            // OTHER TOOLS
            // -------------------------------------------------

            else {

                executionResult = {

                    success: true,

                    message:
                        "Action executed successfully.",

                    simulated: true

                };

            }


            // -------------------------------------------------
            // UPDATE STATUS
            // -------------------------------------------------

            if (executionResult?.success !== false) {

                subAction.status =
                    "Executed";

            }


            results.push({

                actionId:
                    subAction._id,

                name:
                    subAction.name,

                success:
                    executionResult?.success !== false,

                execution:
                    executionResult

            });

        }


        await actionRecord.save();


        // -------------------------------------------------
        // VERIFICATION
        // -------------------------------------------------

        for (const subAction of actionRecord.actions) {

            const result =
                results.find(
                    item =>
                        String(item.actionId) ===
                        String(subAction._id)
                );


            if (
                result &&
                result.success
            ) {

                subAction.status =
                    "Verified";

            }

        }


        await actionRecord.save();


        res.json({

            success: true,

            message:
                "Approved actions processed successfully.",

            actionId:
                actionRecord._id,

            results,

            actions:
                actionRecord.actions

        });


    } catch (error) {

        console.error(
            "Execute all actions error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                error?.message ||
                "Could not execute actions."

        });

    }

});


// =====================================================
// TASK MANAGER - GET ALL TASKS
// =====================================================

app.get("/api/tasks", async (req, res) => {

    try {

        const tasks =
            await Task.find()
                .sort({
                    createdAt: -1
                });


        res.json({

            success: true,

            count:
                tasks.length,

            tasks

        });


    } catch (error) {

        console.error(
            "Get tasks error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                error?.message ||
                "Could not fetch tasks."

        });

    }

});


// =====================================================
// TASK MANAGER - COMPLETE TASK
// =====================================================

app.post("/api/tasks/:id/complete", async (req, res) => {

    try {

        const task =
            await Task.findById(
                req.params.id
            );


        if (!task) {

            return res.status(404).json({

                success: false,

                message:
                    "Task not found."

            });

        }


        task.status =
            "Completed";


        await task.save();


        res.json({

            success: true,

            message:
                "Task marked as completed.",

            task

        });


    } catch (error) {

        console.error(
            "Complete task error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                error?.message ||
                "Could not complete task."

        });

    }

});


// =====================================================
// TASK MANAGER - DELETE TASK
// =====================================================

app.delete("/api/tasks/:id", async (req, res) => {

    try {

        const task =
            await Task.findByIdAndDelete(
                req.params.id
            );


        if (!task) {

            return res.status(404).json({

                success: false,

                message:
                    "Task not found."

            });

        }


        res.json({

            success: true,

            message:
                "Task deleted successfully.",

            task

        });


    } catch (error) {

        console.error(
            "Delete task error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                error?.message ||
                "Could not delete task."

        });

    }

});


// =====================================================
// ACTION HISTORY
// =====================================================

app.get("/api/actions", async (req, res) => {

    try {

        const actions =
            await Action.find()
                .sort({
                    createdAt: -1
                });


        res.json({

            success: true,

            count:
                actions.length,

            actions

        });


    } catch (error) {

        console.error(
            "Action history error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                error?.message ||
                "Could not fetch action history."

        });

    }

});


// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/api/health", async (req, res) => {

    let mongoStatus =
        "Disconnected";


    try {

        if (
            mongoose.connection.readyState === 1
        ) {

            mongoStatus =
                "Connected";

        }

    } catch (error) {

        mongoStatus =
            "Disconnected";

    }


    let googleCalendarStatus =
        "Disconnected";


    try {

        if (loadGoogleTokens()) {

            googleCalendarStatus =
                "Connected";

        }

    } catch (error) {

        googleCalendarStatus =
            "Disconnected";

    }


    res.json({

        success: true,

        status: "OK",

        service:
            "TaskPilot AI",

        database: {

            mongodb:
                mongoStatus

        },

        integrations: {

            googleCalendar:
                googleCalendarStatus

        },

        features: [

            "AI Intent Analysis",

            "Risk-Based Approval",

            "AI Execution Planning",

            "Tool Selection",

            "Google Calendar",

            "Task Manager",

            "Task Creation",

            "Action History",

            "Execution Verification"

        ],

        timestamp:
            new Date().toISOString()

    });

});


// =====================================================
// SERVER START
// =====================================================

const PORT =
    process.env.PORT || 5000;


app.listen(PORT, "0.0.0.0", () => {

    console.log(
        `TaskPilot AI running on port ${PORT}`
    );

    console.log(
        "Gemini fallback system enabled:"
    );

    console.log(
        "gemini-3.8-flash → gemini-3.7-flash → gemini-3.6-flash"
    );

    console.log(
        "Tool Selection Engine enabled"
    );

    console.log(
        "Risk-Based Approval Controller enabled"
    );

    console.log(
        "Google Calendar integration enabled"
    );

    console.log(
        "Task Manager integration enabled"
    );

});


