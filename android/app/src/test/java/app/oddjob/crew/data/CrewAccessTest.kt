package app.oddjob.crew.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/** The October CREW additions: pipeline runs, app record changes, access cards, calendar confirmation. */
class CrewAccessTest {
    private fun obj(json: String): JsonObject = CrewJson.parseToJsonElement(json).jsonObject

    @Test
    fun aPipelineRunProposalNamesThePipelineAndItsInputs() {
        val view = Approvals.fromCard(obj(
            """{"type":"approval_request","kind":"pipeline_run","proposalId":31,"pipelineId":4,"pipelineName":"Nightly sync",
                "inputData":{"region":"emea"},"reason":"Refresh before the review","requestedBy":"Ops"}""",
        ))
        assertEquals("Review the pipeline run", view.section)
        assertEquals(listOf("Pipeline" to "Nightly sync (#4)", "Region" to "emea"), view.details)
        assertTrue(view.readsBack)
        assertTrue(view.noteWhilePending)

        val started = obj("""{"handled":true,"success":true,"status":"started"}""")
        assertEquals(
            "I approved running the pipeline \"Nightly sync\". It has started; its result will be in the recent executions.",
            Approvals.decisionMessage(view, approved = true, action = started),
        )
        val failed = obj("""{"handled":true,"success":false,"status":"failed","error":"Pipeline 4 no longer exists in this organization."}""")
        assertEquals(
            "I approved running the pipeline \"Nightly sync\", but it did not start: Pipeline 4 no longer exists in this organization.",
            Approvals.decisionMessage(view, approved = true, action = failed),
        )
        // The decision response carries the run as `pipelineRun`.
        val outcome = decisionOutcome(obj("""{"message":"Decision recorded","pipelineRun":{"success":true,"status":"started"}}"""), true)
        assertEquals("started", ((outcome as DecisionOutcome.Recorded).action!!["status"] as kotlinx.serialization.json.JsonPrimitive).content)
    }

    @Test
    fun anAppRecordChangeReadsAsTheChangeAndPostsTheWebLine() {
        val view = Approvals.fromCard(obj(
            """{"type":"approval_request","kind":"app_record_action","proposalId":40,"action":"update_record",
                "app":{"id":7,"slug":"budget-master","name":"BudgetMaster"},"collection":"transactions","recordId":"tx-9",
                "data":{"amount":42},"reason":"Fix the amount"}""",
        ))
        assertEquals("App action: update record in transactions", view.heading)
        assertEquals("Approval Request", view.title)
        assertEquals("BudgetMaster", view.section)
        assertEquals(
            listOf("Action" to "Update record", "Collection" to "transactions", "Record ID" to "tx-9", "Amount" to "42"),
            view.details,
        )
        assertEquals(
            "I approved the app action (update record) in \"transactions\" of BudgetMaster.",
            Approvals.decisionMessage(view, approved = true, action = obj("""{"success":true,"recordId":"tx-9"}""")),
        )
        assertEquals(
            "I approved the app action, but it failed: Record tx-9 does not exist.",
            Approvals.decisionMessage(view, approved = true, action = obj("""{"success":false,"error":"Record tx-9 does not exist."}""")),
        )
        assertEquals("I rejected proposal #40 (\"Approval Request\").", Approvals.decisionMessage(view, approved = false))

        // Stored outcome on the row is read back after a reload.
        val row = obj("""{"status":"approved","toolArgs":{"kind":"app_record_action","outcome":{"success":true}}}""")
        assertEquals("true", (Approvals.readBack(row).action!!["success"] as kotlinx.serialization.json.JsonPrimitive).content)
    }

    @Test
    fun aDeleteNeverListsFieldsAndWarnsItIsPermanent() {
        val view = Approvals.fromCard(obj(
            """{"type":"approval_request","kind":"app_record_action","proposalId":41,"action":"delete_record",
                "app":{"name":"BudgetMaster"},"collection":"transactions","recordId":"tx-9","data":{"amount":42}}""",
        ))
        assertEquals(listOf("Action" to "Delete record", "Collection" to "transactions", "Record ID" to "tx-9"), view.details)
        assertEquals("This record will be permanently deleted from 'transactions'.", view.note)
        assertFalse(view.noteWhilePending)
    }

    @Test
    fun aPermissionCardListsStepsAndOnlyLinksIntoAProject() {
        val card = PermissionRequired.parse(obj(
            """{"type":"permission_required","key":"qbo:read","title":"QuickBooks access needed","action":"read QuickBooks Invoice records",
                "reason":"No role","allowedRoles":["Accountant","Executive"],"project":{"id":3,"key":"fin","name":"Finance"},"organizationId":1,
                "steps":[{"id":"connect","label":"Connect QuickBooks","done":true},{"id":"grant","label":"Hold the Accountant role","done":false}],
                "grantedBy":"the project owner","callerCanGrant":false,"manageHref":"/projects/fin?tab=integrations"}""",
        ))!!
        assertEquals("An agent tried to read QuickBooks Invoice records in Finance. That needs the Accountant or Executive finance role.", card.description)
        assertEquals(1, card.remaining.size)
        assertEquals("Ask the project owner to do this.", card.footer)
        assertEquals("/projects/fin?tab=integrations", card.manageHref)

        val offsite = PermissionRequired.parse(obj(
            """{"type":"permission_required","key":"k","steps":[],"manageHref":"https://evil.example/projects/x?y"}""",
        ))!!
        assertNull(offsite.manageHref)
        assertEquals("Every step is done. Ask again.", offsite.footer)
        assertNull(PermissionRequired.parse(obj("""{"type":"permission_required","steps":[]}""")))
    }

    @Test
    fun aPrivateGranolaSearchIsOnlyItsAskers() {
        val card = GranolaPrivateResults.parse(obj(
            """{"type":"granola_private_results","ownerUserId":"u1","organizationId":5,"sessionKey":"room-1",
                "list":{"start_date":"2026-10-01","limit":10},"count":3}""",
        ))!!
        assertTrue(card.isOwner("u1"))
        assertFalse(card.isOwner("u2"))
        assertFalse(card.isOwner(null))
        assertEquals("3 private", card.countLabel)
        assertEquals(mapOf("start_date" to "2026-10-01", "limit" to "10"), card.list)
        assertNull(GranolaPrivateResults.parse(obj("""{"type":"granola_private_results","ownerUserId":"u1","organizationId":5}""")))

        val meeting = GranolaMeeting("m1", "Kickoff", "2026-10-14T09:00:00Z", listOf("Ana", "Ben", "Cy", "Di", "Ed"))
        assertEquals("2026-10-14 · Ana, Ben, Cy, Di", meeting.meta)
    }

    @Test
    fun aReauthorizationOnlyOpensServerPaths() {
        assertEquals("/api/connectors/google/oauth/initiate?orgId=1", Reauthorization(reconnectUrl = "/api/connectors/google/oauth/initiate?orgId=1").safePath)
        assertNull(Reauthorization(reconnectUrl = "https://evil.example/").safePath)
        assertNull(Reauthorization(reconnectUrl = "//evil.example/").safePath)
        assertEquals("Your account", Reauthorization(kind = "user").scopeNote)
        assertEquals("Project space", Reauthorization(projectId = 2).scopeNote)
        assertEquals("The provider rejected the saved authorization.", Reauthorization(reason = "refresh_rejected").reasonText)
    }

    @Test
    fun aConfirmedEventShowsInTheViewersZoneAndOnlyLinksToGoogle() {
        val event = CalendarConfirmation.parse(obj(
            """{"summary":"Design review","organizer":{"email":"team@x.io"},"location":"Room 4",
                "start":{"dateTime":"2026-10-20T17:00:00Z"},"end":{"dateTime":"2026-10-20T18:00:00Z"},
                "htmlLink":"https://www.google.com/calendar/event?eid=abc"}""",
        ), fallbackCalendar = "primary", zone = ZoneId.of("America/Vancouver"), locale = Locale.US)
        assertEquals("Design review", event.summary)
        assertEquals("Calendar" to "team@x.io", event.lines()[0])
        assertTrue(event.start!!.contains("10:00"))
        assertEquals("America/Vancouver", event.zone)
        assertEquals("https://www.google.com/calendar/event?eid=abc", event.link)

        val allDay = CalendarConfirmation.parse(obj(
            """{"start":{"date":"2026-10-20"},"htmlLink":"https://evil.example/e"}""",
        ), fallbackCalendar = "primary", zone = ZoneId.of("UTC"))
        assertEquals("2026-10-20", allDay.start)
        assertNull(allDay.zone)
        assertNull(allDay.link)
        assertEquals("primary", allDay.calendar)

        assertEquals(
            "Google reports this event was cancelled. No new event was created.",
            CalendarConfirmation.verificationLine(Result.success(obj("""{"found":false}"""))),
        )
        assertTrue(CalendarConfirmation.verificationLine(Result.failure(RuntimeException("x"))).startsWith("Could not verify this event."))
        assertTrue(CalendarConfirmation.verificationLine(
            Result.success(obj("""{"found":true,"verifiedAt":"2026-10-20T18:05:00Z"}""")), ZoneId.of("UTC"), Locale.US,
        ).startsWith("Verified in Google at 6:05:00"))
    }

    @Test
    fun approvalFieldsNameAttendeesAndHideProviderBookkeeping() {
        assertEquals(
            listOf("Attendees" to "Ana <a@x.io>, b@x.io", "Start" to "Date time: 2026-10-09T10:00"),
            ApprovalArgs.fields(obj(
                """{"attendees":[{"email":"a@x.io","displayName":"Ana"},{"email":"b@x.io"}],
                    "start":{"dateTime":"2026-10-09T10:00"},"extendedProperties":{"private":{"crewApprovalId":"1"}},"conferenceDataVersion":1}""",
            )),
        )
        // Past two levels a time reads as itself and CREW's own markers as nothing.
        assertEquals(
            listOf("Event" to "Start: Date time: x\nWhen: Inner: 2026-10-09T10:00"),
            ApprovalArgs.fields(obj(
                """{"event":{"start":{"dateTime":"x"},"when":{"inner":{"dateTime":"2026-10-09T10:00"}},"tag":{"marker":{"crewArgsHash":"h"}}}}""",
            )),
        )
    }
}
