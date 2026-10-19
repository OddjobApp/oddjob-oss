
"""
Static analysis for agent-generated code.
"""

from pyflakes.api import check
from pyflakes.reporter import Reporter
import io

class StaticAnalysis:
    """A simple placeholder for a static analysis component."""

    def analyze_code(self, code):
        """Analyze the given code for potential errors and vulnerabilities."""
        # Use pyflakes to check for errors
        reporter = Reporter(io.StringIO(), io.StringIO())
        check(code, "<string>", reporter)
        errors = reporter.flakes
        for error in errors:
            print(f"Pyflakes error: {error}")
        return errors
