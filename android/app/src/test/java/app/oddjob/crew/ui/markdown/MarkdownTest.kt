package app.oddjob.crew.ui.markdown

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownTest {
    @Test
    fun blocks() {
        val blocks = Markdown.parse(
            """
            ## Findings
            First line
            continues here.

            - one
              - nested
            2. second
            > quoted
            ```kotlin
            val x = 1
            ```
            """.trimIndent(),
        )
        assertEquals(MdBlock.Heading(2, listOf(MdSpan("Findings"))), blocks[0])
        assertEquals(MdBlock.Paragraph(listOf(MdSpan("First line\ncontinues here."))), blocks[1])
        assertEquals(MdBlock.ListItem("•", 0, listOf(MdSpan("one"))), blocks[2])
        assertEquals(MdBlock.ListItem("•", 1, listOf(MdSpan("nested"))), blocks[3])
        assertEquals(MdBlock.ListItem("2.", 0, listOf(MdSpan("second"))), blocks[4])
        assertEquals(MdBlock.Quote(listOf(MdSpan("quoted"))), blocks[5])
        assertEquals(MdBlock.Code("kotlin", "val x = 1"), blocks[6])
        assertEquals(7, blocks.size)
    }

    @Test
    fun unclosedFenceRunsToTheEnd() {
        assertEquals(listOf(MdBlock.Code(null, "a\nb")), Markdown.parse("```\na\nb"))
    }

    @Test
    fun inlineStyles() {
        val spans = Markdown.inline("a **bold** and *it* with `code` and [link](https://x.y/z)")
        assertEquals(
            listOf(
                MdSpan("a "),
                MdSpan("bold", bold = true),
                MdSpan(" and "),
                MdSpan("it", italic = true),
                MdSpan(" with "),
                MdSpan("code", code = true),
                MdSpan(" and "),
                MdSpan("link", url = "https://x.y/z"),
            ),
            spans,
        )
    }

    @Test
    fun literalMarkersSurvive() {
        // snake_case identifiers, a lone asterisk and an unsafe link scheme stay text.
        assertEquals(listOf(MdSpan("use tools_used and get_xray_spec")), Markdown.inline("use tools_used and get_xray_spec"))
        assertEquals(listOf(MdSpan("2 * 3 = 6")), Markdown.inline("2 * 3 = 6"))
        val spans = Markdown.inline("[x](javascript:alert(1))")
        assertTrue(spans.none { it.url != null })
    }

    @Test
    fun relativeLinksAreKept() {
        assertEquals(listOf(MdSpan("room", url = "/workspace/chat/k")), Markdown.inline("[room](/workspace/chat/k)"))
    }
}
