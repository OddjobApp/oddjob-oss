
"""
Test generation for agent-generated code.
"""

import ast

class TestGenerator:
    """A simple placeholder for a test generation component."""

    def generate_tests(self, code):
        """Generate tests for the given code."""
        print("Generating tests...")
        try:
            tree = ast.parse(code)
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef):
                    return self._generate_test_for_function(node)
        except SyntaxError:
            return "# Could not parse code to generate tests"
        return "# No functions found to generate tests for"

    def _generate_test_for_function(self, func_node):
        """Generates a unittest boilerplate with positive and negative tests."""
        func_name = func_node.name
        args = func_node.args.args

        # --- Positive Test Generation ---
        positive_arg_placeholders = ', '.join(['"TODO"' for _ in args])
        positive_assertion = "self.assertIsNotNone(result)" # Default
        if func_node.returns:
            return_type = ast.unparse(func_node.returns).strip()
            if return_type == 'str':
                positive_assertion = "self.assertIsInstance(result, str)"
            elif return_type == 'int':
                positive_assertion = "self.assertIsInstance(result, int)"

        positive_test = f"""    def test_{func_name}_positive(self):
        # result = {func_name}({positive_arg_placeholders})
        # {positive_assertion}
        self.assertTrue(True) # Placeholder
"""

        # --- Negative Test Generation ---
        negative_tests = []
        for i, arg in enumerate(args):
            arg_name = arg.arg
            arg_type = None
            if arg.annotation:
                arg_type = ast.unparse(arg.annotation).strip()

            # Generate a test for passing None
            none_args = ['None' if j == i else '"TODO"' for j in range(len(args))]
            negative_tests.append(f"""    def test_{func_name}_negative_none_for_{arg_name}(self):
        with self.assertRaises(TypeError):
            {func_name}({', '.join(none_args)})
""")

            # Generate a test for passing the wrong type
            if arg_type == 'str':
                wrong_type_args = ['123' if j == i else '"TODO"' for j in range(len(args))]
                negative_tests.append(f"""    def test_{func_name}_negative_wrong_type_for_{arg_name}(self):
        with self.assertRaises(TypeError):
            {func_name}({', '.join(wrong_type_args)})
""")
            elif arg_type == 'int':
                wrong_type_args = ['"abc"' if j == i else '123' for j in range(len(args))]
                negative_tests.append(f"""    def test_{func_name}_negative_wrong_type_for_{arg_name}(self):
        with self.assertRaises(TypeError):
            {func_name}({', '.join(wrong_type_args)})
""")

        all_negative_tests = "\n".join(negative_tests)

        test_code = f"""
import unittest
# from my_module import {func_name}

class Test{func_name.capitalize()}(unittest.TestCase):
{positive_test}
{all_negative_tests}

if __name__ == '__main__':
    unittest.main()
"""
        return test_code
