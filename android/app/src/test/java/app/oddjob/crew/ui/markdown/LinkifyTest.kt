package app.oddjob.crew.ui.markdown

import org.junit.Assert.assertEquals
import org.junit.Test

/** Cases from client/src/components/agent-chat/turn-linkify.test.ts. */
class LinkifyTest {
    private fun links(text: String) = Markdown.inline(text).filter { it.url != null }.map { it.url }

    @Test
    fun bareDomainsWithAPathBecomeLinks() {
        assertEquals(listOf("https://youtube.com/watch?v=abc"), links("Watch youtube.com/watch?v=abc now"))
        assertEquals(listOf("https://www.example.com"), links("see www.example.com"))
        assertEquals(listOf("https://a.io/x"), links("plain https://a.io/x."))
    }

    @Test
    fun filenamesAndBareHostsStayText() {
        assertEquals(emptyList<String>(), links("edit src/index.ts and vitest.config.ts"))
        assertEquals(emptyList<String>(), links("example.com alone"))
    }

    @Test
    fun trailingPunctuationAndAnUnbalancedParenthesisStayOutside() {
        assertEquals(
            listOf(MdSpan("Watch "), MdSpan("youtube.com/watch?v=x", url = "https://youtube.com/watch?v=x"), MdSpan(".")),
            Markdown.inline("Watch youtube.com/watch?v=x."),
        )
        assertEquals(
            listOf(MdSpan("("), MdSpan("youtube.com/watch?v=x", url = "https://youtube.com/watch?v=x"), MdSpan(")")),
            Markdown.inline("(youtube.com/watch?v=x)"),
        )
    }

    @Test
    fun rawAnchorsAndMarkdownLinksKeepTheirText() {
        assertEquals(MdSpan("the doc", url = "https://docs.google.com/d/1"), Markdown.inline("""Open <a href="https://docs.google.com/d/1" target="_blank">the doc</a>""")[1])
        assertEquals(MdSpan("here", url = "https://a.io/x"), Markdown.inline("[here](https://a.io/x)")[0])
        // A script URL in an anchor is not a link.
        assertEquals(emptyList<String>(), links("""<a href="javascript:alert(1)">x</a>"""))
    }

    @Test
    fun codeIsNeverLinked() {
        assertEquals(emptyList<String>(), links("`https://a.io/x`"))
    }

    @Test
    fun boldLinksStayBold() {
        val link = Markdown.inline("**read a.io/x**").first { it.url != null }
        assertEquals(true, link.bold)
    }
}
