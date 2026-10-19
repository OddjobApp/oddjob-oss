package app.oddjob.crew.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Frames as crew-stream.service.ts writes them: `data` is the whole CrewStreamEvent. */
class StreamFramesTest {
    @Test
    fun turnContentCarriesTheTurn() {
        val data = """
            {"type":"turn-content","organizationId":7,"sessionKey":"crew-1",
             "payload":{"round":2,"turn":{"id":41,"speakerType":"agent","speakerName":"Analyst",
               "content":"Hello","round":2,"toolsUsed":[{"name":"google_search","ok":true,"ms":812}],
               "artifacts":[],"createdAt":"2026-10-03T10:00:00.000Z","someNewColumn":true}}}
        """.trimIndent()
        val action = StreamFrames.interpret("turn-content", data)
        assertTrue(action is StreamAction.AppendTurn)
        val turn = (action as StreamAction.AppendTurn).turn
        assertEquals(41, turn.id)
        assertEquals("google_search", turn.toolsUsed.single().name)
    }

    @Test
    fun malformedTurnContentFallsBackToAFetch() {
        assertEquals(StreamAction.Refresh, StreamFrames.interpret("turn-content", """{"payload":{}}"""))
        assertEquals(StreamAction.Refresh, StreamFrames.interpret("turn-content", "not json"))
    }

    @Test
    fun agentTurnFrameIsIgnoredBecauseItsContentFrameCarriesIt() {
        val agent = """{"type":"turn","payload":{"speakerType":"agent","speakerName":"A","round":1}}"""
        val user = """{"type":"turn","payload":{"speakerType":"user"}}"""
        assertEquals(StreamAction.Ignore, StreamFrames.interpret("turn", agent))
        assertEquals(StreamAction.Refresh, StreamFrames.interpret("turn", user))
    }

    @Test
    fun roundEndAndPresenceFrames() {
        assertEquals(StreamAction.RoundEnded, StreamFrames.interpret("round-complete", "{}"))
        assertEquals(StreamAction.RoundEnded, StreamFrames.interpret("round-cancelled", "{}"))
        assertEquals(StreamAction.Refresh, StreamFrames.interpret("participant", "{}"))
        assertEquals(StreamAction.Refresh, StreamFrames.interpret("ready", """{"sessionKey":"crew-1"}"""))
        assertEquals(StreamAction.Ignore, StreamFrames.interpret("typing", "{}"))
        assertEquals(StreamAction.Ignore, StreamFrames.interpret(null, "{}"))
    }
}
