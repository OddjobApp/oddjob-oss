
"""
Critiques agent-generated plans against a constitution.
"""

import os
import litellm
import json

class Critic:
    """
    Evaluates a generated plan against the constitution.
    """

    def __init__(self):
        # Load the constitution
        constitution_path = os.path.join(os.path.dirname(__file__), 'constitution.md')
        with open(constitution_path, 'r') as f:
            self.constitution = f.read()

    def critique_plan(self, plan) -> tuple[bool, str]:
        """
        Critiques a plan against the constitution using an LLM.

        Returns:
            A tuple of (is_compliant, justification).
        """
        print("Critiquing plan with LLM...")

        plan_str = " -> ".join([task.name for task in plan])

        system_prompt = f"""You are a constitutional critic for an AI agent. Your task is to evaluate a proposed plan against a constitution. If the plan violates any principle, you must reject it.

Here is the constitution:
---
{self.constitution}
---

Analyze the following plan. Respond in JSON format with two keys: "is_compliant" (boolean) and "justification" (a string explaining your reasoning).

Plan: {plan_str}
"""

        messages = [{"role": "system", "content": system_prompt}]

        try:
            # In a real setup, the model would be configurable.
            # You would also need to have the appropriate API key (e.g., OPENAI_API_KEY) set as an environment variable.
            response = litellm.completion(
                model=os.environ.get("CRITIC_MODEL", "gemini/gemini-2.5-flash"),
                messages=messages,
                response_format={"type": "json_object"}
            )
            
            response_json = json.loads(response.choices[0].message.content)
            is_compliant = response_json.get("is_compliant", False)
            justification = response_json.get("justification", "No justification provided.")

            return is_compliant, justification

        except Exception as e:
            print(f"Error during LLM critique: {e}")
            # Default to a safe outcome if the LLM fails
            return False, "Could not get a valid critique from the LLM."

    def suggest_replan_strategy(self, justification: str) -> str:
        """Given a justification for a failed plan, suggests a high-level strategy for re-planning."""
        print("Generating re-planning strategy...")

        system_prompt = f"""You are a helpful AI assistant. A plan was rejected for the following reason: '{justification}'.

        Please provide a concise, one-sentence strategy for the planner to follow on its next attempt to avoid this problem. For example, if the plan tried to delete a file, a good strategy would be: 'Do not use any file deletion actions.' or if it tried to access a protected file, a good strategy would be: 'Only access files within the designated project directory.'

        Your strategy:"""
        messages = [{"role": "system", "content": system_prompt}]

        try:
            response = litellm.completion(
                model=os.environ.get("CRITIC_MODEL", "gemini/gemini-2.5-flash"),
                messages=messages
            )
            strategy = response.choices[0].message.content.strip()
            return strategy

        except Exception as e:
            print(f"Error during replan suggestion: {e}")
            return "Try a different approach." # Fallback strategy
