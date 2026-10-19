import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { createLogger } from "../../../utils/logger.js";
import { verifySolverToken } from "../trycua/hil-solver.js";
import { trycuaComputerUseTaskService } from "../trycua/computer-use-task.service.js";

const logger = createLogger("HilSolverRoutes");

/**
 * Mobile HIL solver (Autonomous Operator proposal, Pillar 4).
 *
 * Unauthenticated on purpose: the signed, expiring, single-purpose token in
 * the URL IS the credential. It is delivered over SMS to a phone number the
 * user verified, so a login wall here would defeat the point.
 *
 *   GET  /hil/solve/:token      → minimal solver page
 *   POST /api/hil/solve/:token  → confirm the paused task
 */

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c] as string));
}

function solverPage(status: "ready" | "invalid" | "expired" | "done", opts: {
    token?: string;
    title?: string;
    explanation?: string;
    note?: string;
}): string {
    const palette = `body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
.card{background:#1e293b;border-radius:12px;padding:24px;max-width:420px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.4)}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;line-height:1.5;color:#94a3b8;margin:0 0 16px}
textarea{width:100%;box-sizing:border-box;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:10px;font-size:16px;min-height:72px;margin-bottom:12px}
button{width:100%;padding:12px;border:0;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;margin-bottom:8px}
.go{background:#4f46e5;color:#fff}.stop{background:transparent;color:#f87171;border:1px solid #f87171}
#msg{font-size:14px;min-height:20px;margin-top:8px}`;

    const readyBody = `
<h1>The computer needs you</h1>
<p>${escapeHtml(opts.explanation || "A task paused and is waiting for your input.")}</p>
<p style="color:#64748b;font-size:12px">${escapeHtml(opts.title || "")}</p>
<textarea id="answer" placeholder="Type what it needs (e.g. a code), or leave blank to just approve" autocomplete="off"></textarea>
<button class="go" id="go">Continue task</button>
<button class="stop" id="stop">Stop task</button>
<div id="msg"></div>
<script>
var msg=document.getElementById('msg');
async function submit(allow){
  var text=document.getElementById('answer').value;
  msg.textContent='Working…';
  try{
    var r=await fetch('/api/hil/solve/${opts.token}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({allow:allow,text:text||undefined})});
    var body=await r.json().catch(function(){return {}});
    if(r.ok){document.body.innerHTML='<div class="card"><h1>Done</h1><p>'+(allow?'The task is continuing.':'The task was stopped.')+'</p></div>';}
    else{msg.textContent=body.message||'That link no longer works — it may have expired or already been used.';}
  }catch(e){msg.textContent='Network error — try again.';}
}
document.getElementById('go').onclick=function(){submit(true)};
document.getElementById('stop').onclick=function(){submit(false)};
</script>`;

    const bodies: Record<typeof status, string> = {
        ready: readyBody,
        invalid: `<h1>Link not recognized</h1><p>This solver link is invalid. Ask for a new one from the task that sent it.</p>`,
        expired: `<h1>Link expired</h1><p>Solver links last 90 seconds. ${escapeHtml(opts.note || "Open the app to answer the paused task, or let it send another.")}</p>`,
        done: `<h1>Done</h1><p>${escapeHtml(opts.note || "")}</p>`,
    };

    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Oddjob — solve</title><style>${palette}</style></head><body><div class="card">${bodies[status]}</div></body></html>`;
}

async function grantForToken(token: string): Promise<{ grant: ReturnType<typeof verifySolverToken>; reason?: "expired" }> {
    // Verify the signature but check expiry here, so callers can distinguish
    // "expired" from "forged" for the page/message they show.
    const unsigned = verifySolverToken(token, 0);
    if (!unsigned) return { grant: null };
    if (unsigned.expiresAt <= Date.now()) return { grant: null, reason: "expired" };
    return { grant: unsigned };
}

export const hilSolverPageRouter = Router();
export const hilSolverApiRouter = Router();

hilSolverPageRouter.get("/solve/:token", asyncHandler(async (req: Request, res: Response) => {
    const { grant, reason } = await grantForToken(req.params.token);
    res.setHeader("Cache-Control", "no-store");
    if (!grant) {
        res.status(reason === "expired" ? 410 : 403).type("html").send(solverPage(reason === "expired" ? "expired" : "invalid", {}));
        return;
    }

    const detail = await trycuaComputerUseTaskService.getTaskWithSteps(grant.taskId, grant.organizationId, grant.userId)
        .catch((error: any) => {
            logger.warn("Solver page task lookup failed", { taskId: grant.taskId, error: error?.message });
            return null;
        });
    const task = detail?.task;
    if (!task || task.status !== "needs_confirmation") {
        res.type("html").send(solverPage("done", { note: "This task was already answered or is no longer waiting." }));
        return;
    }

    const pending = (task.result as any)?.pending;
    res.type("html").send(solverPage("ready", {
        token: req.params.token,
        title: task.task,
        explanation: pending?.explanation,
    }));
}));

hilSolverApiRouter.post("/solve/:token", asyncHandler(async (req: Request, res: Response) => {
    const { grant, reason } = await grantForToken(req.params.token);
    if (!grant) {
        res.status(reason === "expired" ? 410 : 403).json({ message: reason === "expired" ? "Link expired" : "Invalid solver link" });
        return;
    }

    const allow = req.body?.allow;
    if (typeof allow !== "boolean") {
        res.status(400).json({ message: "allow is required" });
        return;
    }

    // Never log req.body.text — it routinely carries OTPs and passwords.
    const task = await trycuaComputerUseTaskService.confirmTask({
        taskId: grant.taskId,
        organizationId: grant.organizationId,
        userId: grant.userId,
        allow,
        text: typeof req.body?.text === "string" ? req.body.text : undefined,
    });

    res.json({ ok: true, status: task.task.status });
}));
