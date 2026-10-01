const taskInput = document.getElementById("taskInput");
const planButton = document.getElementById("planButton");
const result = document.getElementById("result");


// =====================================================
// FORMAT AI RESPONSE
// =====================================================

function formatAIResponse(text) {

    return text
        .replace(/\\\*/g, "*")
        .replace(/^### (.*)$/gm, "<h3>$1</h3>")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<strong>$1</strong>")
        .replace(/^\* (.*)$/gm, "<li>$1</li>")
        .replace(/^---$/gm, "<hr>")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\n/g, "<br>")
        .replace(/\*/g, "");
}


// =====================================================
// RISK BADGE
// =====================================================

function getRiskBadge(risk) {

    if (risk === "Low") {

        return `
            <span class="risk-badge low-risk">
                🟢 Low Risk
            </span>
        `;

    }

    if (risk === "Medium") {

        return `
            <span class="risk-badge medium-risk">
                🟡 Medium Risk
            </span>
        `;

    }

    if (risk === "High") {

        return `
            <span class="risk-badge high-risk">
                🔴 High Risk
            </span>
        `;

    }

    return `
        <span class="risk-badge critical-risk">
            🚨 Critical Risk
        </span>
    `;
}


// =====================================================
// TOOL CARDS
// =====================================================

function renderTools(tools) {

    if (!tools || tools.length === 0) {

        return `
            <div class="tools-box">
                <p>No external tools required.</p>
            </div>
        `;
    }


    return `

        <div class="tools-box">

            <h2>🧠 Selected Tools</h2>
<p class="section-description">
    TaskPilot selected the tools required to complete your request.
</p>

            <div class="tool-grid">

                ${tools.map(tool => `

                    <div class="tool-card">

                        <div class="tool-icon">
${
    (tool.key || tool.id) === "study_planner"
        ? "📚"
        : (tool.key || tool.id) === "calendar"
            ? "📅"
            : (tool.key || tool.id) === "email"
                ? "✉️"
                : (tool.key || tool.id) === "task_manager"
                    ? "✅"
                    : "🌐"
}
                        </div>

                        <h3>
                            ${tool.name}
                        </h3>

                        <p>
                            ${tool.description || tool.category || "AI-powered tool"}
                        </p>

                        ${getRiskBadge(tool.risk)}

                    </div>

                `).join("")}

            </div>

        </div>
    `;
}


// =====================================================
// INDIVIDUAL ACTION CARD
// =====================================================

function renderActionCard(action, actionId) {

    const requiresApproval =
        action.requiresApproval === true;

    const approved =
        action.approved === true;

    let statusText = "";
    let buttonHTML = "";

        const displayName =
        action.name === "create_calendar_event"
            ? "Create Calendar Event"
            : action.name === "create_reminder_task"
                ? "Create Reminder Task"
                : action.name;


    // -------------------------------------------------
    // LOW RISK
    // -------------------------------------------------

    if (!requiresApproval) {

        statusText = `
            <div class="action-status ready-status">
                ✅ No human approval required
            </div>
        `;

        buttonHTML = `
            <button
                class="execute-action-btn"
                data-action-id="${actionId}"
                data-sub-action-id="${action._id}"
            >
                ⚙️ Execute
            </button>
        `;

    }


    // -------------------------------------------------
    // APPROVED
    // -------------------------------------------------

    else if (approved) {

        statusText = `
            <div class="action-status approved-status">
                ✅ Human approval granted
            </div>
        `;

        buttonHTML = `
            <button
                class="execute-action-btn"
                data-action-id="${actionId}"
                data-sub-action-id="${action._id}"
            >
                ⚙️ Execute Approved Action
            </button>
        `;

    }


    // -------------------------------------------------
    // PENDING APPROVAL
    // -------------------------------------------------

    else {

        statusText = `
            <div class="action-status pending-status">
                🔐 Human approval required
            </div>
        `;

        buttonHTML = `
            <button
                class="approve-action-btn"
                data-action-id="${actionId}"
                data-sub-action-id="${action._id}"
            >
                🔐 Approve ${displayName}
            </button>
        `;

    }


    return `

        <div class="action-card">

            <div class="action-number">
    ⚡ Action
        </div>

            <h3>
                ${displayName}
            </h3>

            <div class="action-risk">
                ${getRiskBadge(action.risk)}
            </div>

            <p>
                <strong>Approval:</strong>
                ${
                    requiresApproval
                        ? "Required"
                        : "Not Required"
                }
            </p>

            ${statusText}

            <div class="action-controls">
                ${buttonHTML}
            </div>

        </div>

    `;
}


// =====================================================
// RENDER ACTIONS
// =====================================================

function renderActions(actions, actionId) {

    if (!actions || actions.length === 0) {

        return `
            <div class="actions-box">
                <p>No individual actions detected.</p>
            </div>
        `;
    }


    return `

        <div class="actions-box">

            <h2>
                🛡️ Risk-Based Approval
            </h2>

            <p class="section-description">
    TaskPilot controls each action according
    to its individual risk level.
</p>

<div class="agent-pipeline">
    🧠 Plan
    →
    🛡️ Risk
    →
    🔐 Approval
    →
    ⚙️ Execute
    →
    🔎 Verify
</div>

            <div class="action-list">

                ${actions.map(action =>
                    renderActionCard(
                        action,
                        actionId
                    )
                ).join("")}

            </div>

            <p id="actionMessage"></p>

        </div>

    `;
}


// =====================================================
// APPROVE INDIVIDUAL ACTION
// =====================================================

async function approveIndividualAction(
    actionId,
    subActionId,
    button
) {

    button.disabled = true;

    button.innerHTML =
        "⏳ Approving...";


    try {

        const response =
            await fetch("/api/approve-action", {

                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    actionId:
                        actionId,

                    subActionId:
                        subActionId

                })

            });


        const data =
            await response.json();


        if (!data.success) {

            button.disabled = false;

            button.innerHTML =
                "🔐 Approve Action";

            showActionMessage(
                "❌ " + data.message
            );

            return;
        }


        // Update action card
        const card =
            button.closest(".action-card");


        const status =
            card.querySelector(
                ".action-status"
            );


        if (status) {

            status.className =
                "action-status approved-status";

            status.innerHTML =
                "✅ Human approval granted";

        }


        button.outerHTML = `

            <button
                class="execute-action-btn"
                data-action-id="${actionId}"
                data-sub-action-id="${subActionId}"
            >
                ⚙️ Execute Approved Action
            </button>

        `;


        attachExecuteButtons();


     showActionMessage(
    "✅ " +
    (data.action.name || "Action") +
    " approved successfully. Ready for execution."
);


    } catch (error) {

        console.error(
            "Approval error:",
            error
        );


        button.disabled = false;

        button.innerHTML =
            "🔐 Approve Action";


        showActionMessage(
            "❌ Could not approve the action."
        );

    }

}


// =====================================================
// EXECUTE INDIVIDUAL ACTION
// =====================================================

async function executeIndividualAction(
    actionId,
    subActionId,
    button
) {

    button.disabled = true;

    button.innerHTML =
        "⚙️ Executing...";


    try {

        const response =
            await fetch("/api/execute-action", {

                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    actionId:
                        actionId,

                    subActionId:
                        subActionId

                })

            });


        const data =
            await response.json();


        if (!data.success) {

            button.disabled = false;

            button.innerHTML =
                "⚙️ Execute";

            showActionMessage(
                "❌ " + data.message
            );

            return;
        }


        if (data?.execution?.results?.length) {

    const results = data.execution.results;

    const resultsHTML = results.map((item, index) => `
        <div class="web-result">
            <strong>${index
             + 1}. ${item.title || "Search Result"}</strong>
            <p>${item.content || ""}</p>
            <a href="${item.url}" target="_blank">
                ${item.url}
            </a>
        </div>
    `).join("");

    showActionMessage(
        "🌐 Web Search Results",
        resultsHTML
    );

}


        button.innerHTML =
            "✅ Completed";


        button.classList.add(
            "completed-btn"
        );


        const card =
            button.closest(".action-card");


        const status =
            card.querySelector(
                ".action-status"
            );


        if (status) {

            status.className =
                "action-status verified-status";

            status.innerHTML =
                "✅ Executed & Verified";

        }


        if (!data?.execution?.results?.length) {

    const verification =
        data?.execution?.verification;

    const verificationMessage =
        verification?.message ||
        "Action verified successfully.";

    showActionMessage(
        "✅ " +
        (data.action?.name || "Action") +
        " executed and verified." +
        "<br><small>🔎 " +
        verificationMessage +
        "</small>"
    );
}


  } catch (error) {

    console.error(
        "Execution error:",
        error
    );

    button.disabled = false;

    button.innerHTML =
        "⚙️ Execute";

    showActionMessage(
        "❌ Action execution failed. " +
        "TaskPilot could not complete this action. " +
        "Please try again."
    );

}

}


// =====================================================
// ATTACH APPROVAL BUTTONS
// =====================================================

function attachApprovalButtons() {

    const buttons =
        document.querySelectorAll(
            ".approve-action-btn"
        );


    buttons.forEach(button => {

        button.addEventListener(
            "click",
            async () => {

                await approveIndividualAction(

                    button.dataset.actionId,

                    button.dataset.subActionId,

                    button

                );

            }
        );

    });

}


// =====================================================
// ATTACH EXECUTE BUTTONS
// =====================================================

function attachExecuteButtons() {

    const buttons =
        document.querySelectorAll(
            ".execute-action-btn"
        );


    buttons.forEach(button => {

        // Prevent duplicate listeners
        if (
            button.dataset.listenerAttached ===
            "true"
        ) {

            return;

        }


        button.dataset.listenerAttached =
            "true";


        button.addEventListener(
            "click",
            async () => {

                await executeIndividualAction(

                    button.dataset.actionId,

                    button.dataset.subActionId,

                    button

                );

            }
        );

    });

}


// =====================================================
// ACTION MESSAGE
// =====================================================

function showActionMessage(message, html = false) {

    const element =
        document.getElementById(
            "actionMessage"
        );


    if (element) {

        element.innerHTML = html || message;

    }

}


// =====================================================
// GENERATE PLAN
// =====================================================

planButton.addEventListener(
    "click",
    async () => {

        const task =
            taskInput.value.trim();


        if (!task) {

            result.innerHTML =
                "<p>Please describe a task first.</p>";

            return;
        }


        result.innerHTML = `

            <div class="loading-box">

                <div class="loading-spinner">
                    🧠
                </div>

                <p>
                    TaskPilot is understanding
                    your task...
                </p>

            </div>

        `;


        try {

            const response =
                await fetch("/api/plan", {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        task: task
                    })

                });


            const data =
                await response.json();


            if (!data.success) {

                result.innerHTML = `

                    <div class="error-box">

                        ❌ ${data.message}

                    </div>

                `;

                return;
            }


            // =================================================
            // DISPLAY COMPLETE RESULT
            // =================================================

            result.innerHTML = `

                <h2>
                    Your Task Plan
                </h2>


                <div class="ai-response">

                    ${formatAIResponse(
                        data.plan
                    )}

                </div>


                ${renderTools(
                    data.tools
                )}


                ${renderActions(
                    data.actions,
                    data.actionId
                )}


                <div class="model-info">

                    🤖 AI Model:
                    <strong>
                        ${data.model || "Gemini"}
                    </strong>

                </div>

            `;


            // Attach buttons
            attachApprovalButtons();

            attachExecuteButtons();


        } catch (error) {

            console.error(
                "Plan generation error:",
                error
            );


            result.innerHTML = `

                <div class="error-box">

                    ❌ Something went wrong.
                    Please try again.

                </div>

            `;

        }

    }
);


// =====================================================
// ACTION HISTORY
// =====================================================

const historyButton =
    document.getElementById(
        "historyButton"
    );


const historyList =
    document.getElementById(
        "historyList"
    );


historyButton.addEventListener(
    "click",
    async () => {

        historyList.innerHTML =
            "<p>Loading action history...</p>";


        try {

            const response =
                await fetch(
                    "/api/actions"
                );


            const data =
                await response.json();


            if (!data.success) {

                historyList.innerHTML =
                    "<p>Could not load history.</p>";

                return;
            }


            if (
                data.actions.length ===
                0
            ) {

                historyList.innerHTML =
                    "<p>No actions found yet.</p>";

                return;
            }


 const recentActions =
    data.actions.slice(0, 10);

historyList.innerHTML =
    recentActions.map(
                    action => `

                    <div class="history-card">

<h3>
    ${
        action.status === "Verified"
            ? "✅ Verified"
            : action.status === "Approved"
                ? "🟢 Approved"
                : action.status === "Pending"
                    ? "⏳ Pending"
                    : "📋 " + action.status
    }
</h3>

                        <p>

                            <strong>
                                Task:
                            </strong>

                            ${action.task}

                        </p>


                       <p>

    <strong>
        Overall Approval:
    </strong>

    ${
        action.approved
            ? "✅ Approved"
            : "⏳ Pending"
    }

</p>

${
    action.actions &&
    action.actions.length > 0
        ? `
            <p>
                <strong>
                    Action Progress:
                </strong>

                ${
                    action.actions.filter(
                        item =>
                            item.status === "Verified"
                    ).length
                }
                /
                ${action.actions.length}
                Actions Verified
            </p>
        `
        : ""
}


                        ${
                            action.actions &&
                            action.actions.length > 0

                                ? `

                                    <div class="history-actions">

                                        <strong>
                                            Actions:
                                        </strong>

                                      ${action.actions.map(
    item => `
        <div class="history-action-item">

           <strong>
    ${
        item.name === "create_calendar_event"
            ? "Calendar Event"
            : item.name === "create_reminder_task"
                ? "Create Reminder Task"
                : item.name
    }
            </strong>

            <div class="history-action-details">

                <span>
                    <strong>Risk:</strong>
                    ${getRiskBadge(item.risk)}
                </span>

                <span>
                    <strong>Status:</strong>
                    ${
                        item.status === "Verified"
                            ? "✅ Verified"
                            : item.status === "Approved"
                                ? "🟢 Approved"
                                : item.status === "Pending"
                                    ? "⏳ Pending"
                                    : item.status
                    }
                </span>

                <span>
                    <strong>Approval:</strong>
                    ${
                        item.requiresApproval
                            ? (
                                item.approved
                                    ? "✅ Approved"
                                    : "🔐 Required"
                            )
                            : "🟢 Not Required"
                    }
                </span>

            </div>

        </div>
    `
).join("")}

                                    </div>

                                `

                                : ""
                        }


                        <p>

                            <strong>
                                Created:
                            </strong>

                            ${new Date(
                                action.createdAt
                            ).toLocaleString()}

                        </p>

                    </div>

                `
                ).join("");


        } catch (error) {

            console.error(
                "History error:",
                error
            );


            historyList.innerHTML =
                "<p>Something went wrong while loading history.</p>";

        }

    }
);


// =====================================================
// INTENT + RISK ANALYSIS BUTTON
// =====================================================

const intentButton =
    document.getElementById(
        "intentButton"
    );


const intentResult =
    document.getElementById(
        "intentResult"
    );


intentButton.addEventListener(
    "click",
    async () => {

        const task =
            taskInput.value.trim();


        if (!task) {

            intentResult.innerHTML =
                "<p>⚠️ Please enter a task first.</p>";

            return;

        }


        intentResult.innerHTML =
            "<p>🧠 Analyzing intent and risk...</p>";


        try {

            const response =
                await fetch(
                    "/api/intent",
                    {

                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            task: task
                        })

                    }
                );


            const data =
                await response.json();


            if (!data.success) {

                intentResult.innerHTML =
                    `<p>❌ ${data.message}</p>`;

                return;

            }


            const intent =
                data.intent;


           const intentText =
    data.intent || "General task";

const actions =
    Array.isArray(data.actions)
        ? data.actions
        : [];

intentResult.innerHTML = `
    <div class="intent-card">

        <h3>
            🎯 Detected Intent
        </h3>

        <p>
            ${intentText}
        </p>

        <h3>
            🛡️ Risk & Action Analysis
        </h3>

        ${
    actions.length > 0
        ? actions.map(
                    action => `
                        <div class="risk-item">

                            <strong>
    ${
        action.name === "create_calendar_event"
            ? "📅 Create Calendar Event"
            : action.name === "create_reminder_task"
                ? "🔔 Create Reminder Task"
                : action.name
    }
</strong>
                                

                            <p>
                                <strong>Risk Level:</strong>
                                ${getRiskBadge(action.risk)}
                            </p>

                            <p>
                                <strong>Approval:</strong>
                                ${
                                    action.requiresApproval
                                        ? "🟡 Human approval required"
                                        : "🟢 No approval required"
                                }
                            </p>

                            <p>
                                <strong>Action Status:</strong>
                                ${
                                    action.requiresApproval
                                        ? "⏳ Waiting for approval"
                                        : "⚡ Ready to execute"
                                }
                            </p>

                        </div>
                    `
                ).join("")
                : `
                    <p>
                        No specific actions detected.
                    </p>
                `
        }

    </div>
`;


        } catch (error) {

            console.error(
                "Intent error:",
                error
            );


            intentResult.innerHTML =
                "<p>❌ Could not analyze intent.</p>";

        }

    }
);