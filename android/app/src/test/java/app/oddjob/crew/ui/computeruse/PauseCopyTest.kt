package app.oddjob.crew.ui.computeruse

import app.oddjob.crew.data.ComputerUsePending
import app.oddjob.crew.data.ComputerUseResult
import app.oddjob.crew.data.ComputerUseTask
import org.junit.Assert.assertEquals
import org.junit.Test

class PauseCopyTest {
    private fun task(kind: String?, explanation: String? = null) =
        ComputerUseTask(id = "t", task = "Book a room", status = "needs_confirmation", result = ComputerUseResult(ComputerUsePending(kind, explanation)))

    @Test
    fun aSafetyPauseAsksForApproval() {
        val copy = pauseCopy(task("safety", "Submit the payment form?"))
        assertEquals("A computer action needs your approval", copy.title)
        assertEquals("Submit the payment form?", copy.prompt)
        assertEquals("Approve and continue", copy.continueLabel)
    }

    @Test
    fun aHandoffAsksForAReplyAndFallsBackWhenTheModelGaveNoReason() {
        val copy = pauseCopy(task("yield", "  "))
        assertEquals("The computer needs you", copy.title)
        assertEquals("The agent stopped and is waiting for you.", copy.prompt)
        assertEquals("Continue task", copy.continueLabel)
    }

    @Test
    fun settledTasksAreDescribedPlainly() {
        assertEquals("The task was stopped.", settledLine("cancelled"))
        assertEquals("The task is waiting for you again.", settledLine("needs_confirmation"))
        assertEquals("The task is paused_by_admin.", settledLine("paused_by_admin"))
    }
}
