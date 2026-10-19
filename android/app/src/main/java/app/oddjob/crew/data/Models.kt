package app.oddjob.crew.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/*
 * Wire shapes for /api/crew, mirroring shared/schema/crew.ts and the route
 * handlers in server/domain/crew/api/crew.routes.ts. Every field the client
 * does not strictly need is optional, and the Json instance ignores unknown
 * keys, so a server that grows a column does not break an installed app.
 */

@Serializable
data class RoomSummary(
    val sessionKey: String,
    val title: String? = null,
    val status: String = "active",
    val role: String? = null,
    val projectId: Int? = null,
    val activeTopic: String? = null,
    val participantCount: Int = 0,
    val attachmentCount: Int = 0,
    val isBreakout: Boolean = false,
    val updatedAt: String? = null,
    /** The room's organization: the list spans every org the person belongs to. */
    val organizationId: Int? = null,
    val organizationName: String? = null,
)

@Serializable
data class RoomsResponse(val rooms: List<RoomSummary> = emptyList(), val scope: String? = null)

@Serializable
data class CrewSession(
    val id: Int,
    val organizationId: Int,
    val sessionKey: String,
    val title: String? = null,
    val status: String = "active",
    val mode: String = "explore",
    val activeTopic: String? = null,
    val nextSteps: String? = null,
    val consensusLevel: Int? = null,
    val interrupting: Boolean = false,
    val projectId: Int? = null,
    val memory: RoomMemory? = null,
)

/** The parts of crew_sessions.memory the phone reads. */
@Serializable
data class RoomMemory(
    val roomBrief: RoomBrief? = null,
    /** Each person's chosen agents in this room, by user id (PUT /:key/active-agents). */
    val activeAgentSelections: Map<String, List<Int>> = emptyMap(),
)

@Serializable
data class ToolUse(
    val name: String,
    val ok: Boolean = true,
    val ms: Long? = null,
    val error: String? = null,
)

@Serializable
data class TurnArtifact(val tool: String, val payload: JsonObject? = null)

@Serializable
data class CrewTurn(
    val id: Int,
    /** "user", "agent" or "supervisor". */
    val speakerType: String,
    val speakerName: String,
    val agentCardId: Int? = null,
    val userId: String? = null,
    val content: String = "",
    val round: Int = 0,
    val inReplyToTurnId: Int? = null,
    val servedModel: String? = null,
    val servedProvider: String? = null,
    val wasFallback: Boolean? = null,
    val latencyMs: Long? = null,
    /** What the agent actually ran — the ground truth, not the prose. */
    val toolsUsed: List<ToolUse> = emptyList(),
    val artifacts: List<TurnArtifact> = emptyList(),
    val createdAt: String? = null,
)

@Serializable
data class AgentCard(
    val id: Int,
    val name: String,
    val description: String? = null,
    val personaType: String? = null,
    val soulArchetype: String? = null,
    val legend: String? = null,
    val enabled: Boolean = true,
    val tools: List<String> = emptyList(),
    val capabilities: List<String> = emptyList(),
)

@Serializable
data class Participant(
    val userId: String,
    val username: String? = null,
    val displayName: String? = null,
    val role: String? = null,
)

@Serializable
data class SupervisorNote(
    val id: Int,
    val noteType: String? = null,
    val content: String = "",
    val round: Int = 0,
)

@Serializable
data class Decision(
    val id: Int,
    val statement: String,
    val rationale: String? = null,
    val status: String = "proposed",
)

@Serializable
data class Claim(
    val id: Int,
    val claim: String,
    val status: String = "unverified",
)

@Serializable
data class Commitment(
    val id: Int,
    val title: String,
    val detail: String? = null,
    val status: String = "open",
    val dueAt: String? = null,
)

/** GET /api/crew/:sessionKey — full state, or a delta when `since` was sent. */
@Serializable
data class RoomResponse(
    val session: CrewSession? = null,
    val members: List<AgentCard> = emptyList(),
    val turns: List<CrewTurn> = emptyList(),
    val notes: List<SupervisorNote> = emptyList(),
    val decisions: List<Decision> = emptyList(),
    val claims: List<Claim> = emptyList(),
    val commitments: List<Commitment> = emptyList(),
    val participants: List<Participant> = emptyList(),
    /** Turns carrying a work product, sent apart from the transcript window. */
    val workProductTurns: List<WorkProductTurn> = emptyList(),
    val currentUserId: String? = null,
    val delta: Boolean = false,
    val cursor: Int? = null,
)

@Serializable
data class SessionEnvelope(val session: CrewSession? = null)

/** POST /:sessionKey/work-product answers with the turn it posted. */
@Serializable
data class TurnEnvelope(val turn: CrewTurn? = null)

/** POST /:sessionKey/notification-context: the triggering email, posted as a turn. */
@Serializable
data class NotificationContext(val turn: CrewTurn? = null, val payload: WorkspaceResults? = null, val reason: String? = null)

/** A file in the room (GET/POST /api/crew/:sessionKey/attachments), as CrewAttachmentBar shows it. */
@Serializable
data class CrewAttachment(
    val id: Int,
    val displayName: String = "",
    val mimeType: String? = null,
    val byteSize: Long = 0,
    /** "parsed" once readable; "pending", "failed", "unsupported" otherwise. */
    val parseStatus: String = "pending",
    /** "image", "table", "text" … */
    val parseType: String? = null,
    val indexStatus: String? = null,
    val createdAt: String? = null,
) {
    val readable: Boolean get() = parseStatus == "parsed"
}

@Serializable
data class AttachmentsEnvelope(
    val attachments: List<CrewAttachment> = emptyList(),
    /** The turn the upload posted to the room (thumbnails and document cards). */
    val turn: CrewTurn? = null,
)

/** A file picked on the phone, ready to upload. */
class UploadFile(val name: String, val mimeType: String, val bytes: ByteArray)

@Serializable
data class ActiveAgentsEnvelope(val agentCardIds: List<Int> = emptyList())

@Serializable
data class MembersEnvelope(val members: List<AgentCard> = emptyList())

@Serializable
data class CurrentUser(
    val authenticated: Boolean = false,
    val username: String? = null,
    val firstName: String? = null,
    val lastName: String? = null,
    val csrfToken: String? = null,
)

/** Values accepted by PATCH /:sessionKey/state and the record PATCH routes. */
object CrewEnums {
    val roomModes = listOf("explore", "decide", "build", "investigate", "operate", "review")
    val decisionStatuses = listOf("proposed", "accepted", "rejected", "superseded")
    val claimStatuses = listOf("unverified", "supported", "disputed", "refuted")
    val commitmentStatuses = listOf("open", "in_progress", "blocked", "completed", "cancelled")
}

/** GET /api/users/current and PATCH /api/users/me (the self-service subset). */
@Serializable
data class UserProfile(
    val id: String,
    val username: String,
    val email: String? = null,
    val firstName: String? = null,
    val lastName: String? = null,
    val slackHandle: String? = null,
    val quietHoursEnabled: Boolean? = null,
    val quietHoursStart: String? = null,
    val quietHoursEnd: String? = null,
    val quietHoursTimezone: String? = null,
)

/** GET /api/push/config. `devices` is phone (FCM) push, separate from browser push. */
@Serializable
data class PushConfig(val enabled: Boolean = false, val devices: Boolean = false)

/**
 * GET /api/integrations/trycua/computer-use/tasks/:id — only the parts the
 * pause screen reads. `result` is free-form JSON on the server; [pending] is
 * what the agent left there when it stopped for a person.
 */
@Serializable
data class ComputerUseTaskEnvelope(val task: ComputerUseTask)

@Serializable
data class ComputerUseTask(
    val id: String,
    val task: String = "",
    val status: String = "",
    val organizationId: Int? = null,
    val result: ComputerUseResult? = null,
) {
    val waitingForPerson: Boolean get() = status == "needs_confirmation"
    val pending: ComputerUsePending? get() = result?.pending
}

@Serializable
data class ComputerUseResult(val pending: ComputerUsePending? = null)

/** `kind` is "yield" (hand the desktop to a person) or "safety" (approve a risky action). */
@Serializable
data class ComputerUsePending(
    val kind: String? = null,
    val explanation: String? = null,
    val action: String? = null,
)
