
"""
HTN agent loop implementation.
"""

import re

from typing import Any, Dict, List

from backend.core.agent_registry import register_agent
from external.cua.libs.python.agent.cua_agent.loops.base import AsyncAgentConfig
from .planner import Planner, Task
from .mcts import MCTS
from .state import WorldState
from .environment import BrowserEnvironment
from ...memory.episodic_memory import EpisodicMemory
from ...memory.semantic_memory import SemanticMemory
from ...memory.procedural_memory import ProceduralMemory

@register_agent(
    "htn",
    capabilities=["htn"],
    description="An agent loop that uses a Hierarchical Task Network (HTN) planner and Monte Carlo Tree Search (MCTS) to make decisions.",
)
class HTNAgentLoop(AsyncAgentConfig):
    """HTN agent loop."""

    def __init__(self):
        super().__init__()
        self.episodic_memory = EpisodicMemory()
        self.semantic_memory = SemanticMemory()
        self.procedural_memory = ProceduralMemory()

    async def predict_step(
        self,
        messages: List[Dict[str, Any]],
        model: str,
        tools: List[Dict[str, Any]],
        **kwargs,
    ) -> Dict[str, Any]:
        """Predict the next step in the agent's execution."""

        # 1. Goal Parsing
        user_goal_str = messages[-1]["content"]
        url_match = re.search(r'https?://[\S]+', user_goal_str)
        url = url_match.group(0) if url_match else None
        
        if "navigate" in user_goal_str and url:
            goal_task = Task("navigate_to_website", url=url)
        else:
            return {"output": [{"error": "I can only navigate to websites for now."}]}

        # 2. Setup Environment and Planner
        initial_state = WorldState()
        environment = BrowserEnvironment(initial_state)
        methods = self._define_methods()

        # 3. Load World Model
        import os
        import torch
        from ...memory.world_model import WorldModel
        from .representation import STATE_VECTOR_SIZE, ACTION_VECTOR_SIZE
        world_model = WorldModel(state_size=STATE_VECTOR_SIZE, action_size=ACTION_VECTOR_SIZE)
        model_path = 'world_model.pth'
        if os.path.exists(model_path):
            world_model.load_state_dict(torch.load(model_path))
            world_model.eval()

        mcts = MCTS(environment=environment, world_model=world_model)

        # 4. Critique and Revise Loop
        MAX_REVISIONS = 3
        constraints = set()
        plan = None
        for i in range(MAX_REVISIONS):
            planner = Planner(methods=methods, world_state=initial_state, semantic_memory=self.semantic_memory, constraints=constraints)
            current_plan = planner.plan([goal_task])

            from ...validation.critic import Critic
            critic = Critic()
            is_compliant, justification = critic.critique_plan(current_plan)

            if is_compliant:
                plan = current_plan
                break
            
            print(f"Plan rejected: {justification}")
            replan_strategy = critic.suggest_replan_strategy(justification)
            goal_task = Task(goal_task.name, **goal_task.parameters, strategy=replan_strategy)
        
        if not plan:
             return {"output": [{"error": "Could not generate a compliant plan."}]}

        # 5. Execute Plan (via MCTS)
        best_action = mcts.search(plan, num_simulations=100)

        # 6. Store Experience
        # The state stored should be the state *before* the action was taken.
        self.episodic_memory.add_experience((initial_state, plan))

        # 7. Distill Knowledge
        from ...memory.knowledge_distiller import KnowledgeDistiller
        distiller = KnowledgeDistiller(self.episodic_memory, self.semantic_memory)
        distiller.distill_knowledge()

        return {"output": [best_action]}

    def _define_methods(self):
        """Define the methods for the HTN planner."""
        methods = []
        # --- Dynamic Skill Loading ---
        discovered_skills = self.procedural_memory.skill_library
        for skill_name, methods_list in discovered_skills.items():
            methods.extend(methods_list)

        from .planner import Task, Method
        # Define task templates
        navigate_task = Task("navigate_to_website", url=None)
        # Define methods
        navigate_method = Method(
            name="navigate_by_typing",
            task=navigate_task,
            preconditions=[lambda state: state.is_browser_open],
            subtasks=[
                Task("type_url", url=None),
                Task("press_enter"),
            ],
        )
        open_browser_method = Method(
            name="open_browser_first",
            task=navigate_task,
            preconditions=[lambda state: not state.is_browser_open],
            subtasks=[
                Task("open_browser"),
                Task("type_url", url=None),
                Task("press_enter"),
            ],
        )
        methods.extend([navigate_method, open_browser_method])
        return methods
