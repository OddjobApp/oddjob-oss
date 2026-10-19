package app.oddjob.crew.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

/*
 * What a room says about access: a refused call the person can do something
 * about, a private search only its asker can see, and connections whose
 * authorization has to be renewed.
 */

private fun JsonObject.str(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }

/** One step towards access (shared/crew-permission.ts): connect, join or grant. */
data class PermissionStep(val id: String, val label: String, val done: Boolean)

/**
 * A `permission_required` card: what was refused, the steps that would allow
 * it in order, and who can take them. Mirrors PermissionRequiredCard.tsx.
 */
data class PermissionRequired(
    val title: String,
    val action: String,
    val allowedRoles: List<String>,
    val projectName: String?,
    val steps: List<PermissionStep>,
    val grantedBy: String,
    val callerCanGrant: Boolean,
    /** An in-app project path only: the payload is stored and replayed with the turn. */
    val manageHref: String?,
) {
    val remaining: List<PermissionStep> get() = steps.filter { !it.done }

    val description: String get() =
        "An agent tried to $action${projectName?.let { " in $it" } ?: ""}. That needs the ${allowedRoles.joinToString(" or ")} finance role."

    val footer: String get() = when {
        remaining.isEmpty() -> "Every step is done. Ask again."
        callerCanGrant -> "You can do these yourself in the project’s Integrations tab."
        else -> "Ask $grantedBy to do ${if (remaining.size == 1) "this" else "these"}."
    }

    companion object {
        private val projectPath = Regex("^/projects/[^/?#]+\\?")

        fun parse(p: JsonObject): PermissionRequired? {
            if (p.str("type") != "permission_required" || p.str("key") == null) return null
            val steps = (p["steps"] as? JsonArray ?: return null).mapNotNull { e ->
                val o = e as? JsonObject ?: return@mapNotNull null
                PermissionStep(o.str("id") ?: return@mapNotNull null, o.str("label") ?: return@mapNotNull null,
                    (o["done"] as? JsonPrimitive)?.booleanOrNull == true)
            }
            return PermissionRequired(
                title = p.str("title") ?: "Access needed",
                action = p.str("action") ?: "do this",
                allowedRoles = (p["allowedRoles"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty(),
                projectName = (p["project"] as? JsonObject)?.str("name"),
                steps = steps,
                grantedBy = p.str("grantedBy") ?: "an org admin",
                callerCanGrant = (p["callerCanGrant"] as? JsonPrimitive)?.booleanOrNull == true,
                manageHref = p.str("manageHref")?.takeIf { projectPath.containsMatchIn(it) },
            )
        }
    }
}

/**
 * A room search of someone's Granola notes. The payload holds no meeting data:
 * only its asker lists the matches, from their own account, and shares one
 * into the room. Mirrors GranolaPrivateResultsCard.tsx.
 */
data class GranolaPrivateResults(
    val ownerUserId: String,
    val organizationId: Int,
    val sessionKey: String,
    val query: String?,
    /** A list request's filters (start_date, end_date, folder_id, limit). */
    val list: Map<String, String>,
    val count: Int?,
) {
    val countLabel: String get() = count?.let { "$it private" } ?: "Private"

    fun isOwner(viewerId: String?) = viewerId != null && viewerId == ownerUserId

    companion object {
        fun parse(p: JsonObject): GranolaPrivateResults? {
            if (p.str("type") != "granola_private_results") return null
            return GranolaPrivateResults(
                ownerUserId = p.str("ownerUserId") ?: return null,
                organizationId = (p["organizationId"] as? JsonPrimitive)?.intOrNull ?: return null,
                sessionKey = p.str("sessionKey") ?: return null,
                query = p.str("query"),
                list = (p["list"] as? JsonObject)?.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.contentOrNull?.let { k to it } }?.toMap().orEmpty(),
                count = (p["count"] as? JsonPrimitive)?.intOrNull,
            )
        }
    }
}

/** One of the asker's own meetings, as GET /api/me/connections/granola/meetings lists it. */
@Serializable
data class GranolaMeeting(
    val id: String,
    val title: String = "Granola meeting",
    val meetingDate: String? = null,
    val attendees: List<String> = emptyList(),
    val preview: String? = null,
) {
    /** "2026-10-14 · Ana, Ben": the date and the first four attendees. */
    val meta: String get() = listOfNotNull(meetingDate?.take(10)?.takeIf { it.isNotBlank() }, attendees.take(4).joinToString(", ").ifBlank { null })
        .joinToString(" · ")
}

@Serializable
data class GranolaMeetingsEnvelope(val meetings: List<GranolaMeeting> = emptyList())

/** A connection whose OAuth grant expired and cannot be renewed (shared/oauth-reauthorization.ts). */
@Serializable
data class Reauthorization(
    val kind: String = "organization",
    val platform: String = "",
    val label: String = "",
    val connectorId: Int = 0,
    val projectId: Int? = null,
    val reason: String? = null,
    /** An OAuth initiate route or a dashboard path, relative to the server. */
    val reconnectUrl: String = "",
    val opensDashboard: Boolean = false,
    val canReauthorize: Boolean = false,
) {
    val scopeNote: String get() = when {
        kind == "user" -> "Your account"
        projectId != null -> "Project space"
        else -> "Organization"
    }

    val reasonText: String get() = when (reason) {
        "refresh_rejected" -> "The provider rejected the saved authorization."
        "no_refresh_token" -> "The saved authorization can no longer be renewed."
        "credentials_missing" -> "Saved credentials are missing."
        else -> "Authorization expired."
    }

    /** Only a path on the Oddjob server: the phone never follows an absolute URL from the list. */
    val safePath: String? get() = reconnectUrl.takeIf { it.startsWith("/") && !it.startsWith("//") }
}

@Serializable
data class ReauthorizationsEnvelope(val items: List<Reauthorization> = emptyList())
