
"""
Hierarchical Task Network (HTN) planner.
"""

class Task:
    """A task is a high-level action that can be decomposed into smaller sub-tasks."""
    def __init__(self, name, **kwargs):
        self.name = name
        self.parameters = kwargs

    def __repr__(self):
        params_str = ', '.join(f'{k}={v!r}' for k, v in self.parameters.items())
        return f"Task(name='{self.name}', {params_str})"

    def __eq__(self, other):
        if not isinstance(other, Task):
            return NotImplemented
        # For planning and LCS, we consider tasks equal if their names and parameter keys match.
        # The values can differ.
        return self.name == other.name and self.parameters.keys() == other.parameters.keys()

    def __hash__(self):
        # Create a hash based on the name and the sorted keys of the parameters.
        return hash((self.name, tuple(sorted(self.parameters.keys()))))

class Method:
    """A method is a way to decompose a task into a sequence of sub-tasks."""
    def __init__(self, name, task, preconditions, subtasks):
        self.name = name
        self.task = task
        self.preconditions = preconditions
        self.subtasks = subtasks

class Planner:
    """The HTN planner."""
    def __init__(self, methods, world_state, semantic_memory, constraints=None):
        self.methods = methods
        self.world_state = world_state
        self.semantic_memory = semantic_memory
        self.constraints = constraints or set()

    def plan(self, goal):
        """Generate a plan to achieve a given goal."""
        plan = []
        result = self._seek_plan(goal, [], self.world_state.copy())
        return result

    def _seek_plan(self, tasks, plan, state):
        """Recursively search for a plan to achieve a list of tasks."""
        if not tasks:
            return plan

        task = tasks[0]
        remaining_tasks = tasks[1:]

        if self._is_primitive(task, state):
            # --- New: Enforce Constraints ---
            if task.name in self.constraints:
                return None # This path is blocked by a constraint

            # Here we would apply the primitive action to the state
            # For now, we assume it succeeds
            return self._seek_plan(remaining_tasks, plan + [task], state)
        else:
            for method in self._find_methods(task, state):
                # --- New: Parameter Substitution ---
                substituted_subtasks = []
                for subtask in method.subtasks:
                    # Create a new subtask with the parameters from the parent task
                    substituted_params = subtask.parameters.copy()
                    for key, value in task.parameters.items():
                        if key in substituted_params:
                            substituted_params[key] = value
                    substituted_subtasks.append(Task(subtask.name, **substituted_params))

                new_tasks = substituted_subtasks + remaining_tasks
                result = self._seek_plan(new_tasks, plan, state.copy())
                if result is not None:
                    return result

        return None

    def _is_primitive(self, task, state):
        """Check if a task is primitive (i.e., it cannot be decomposed further)."""
        return not self._find_methods(task, state)

    def _find_methods(self, task, state):
        """Find all methods that can be used to decompose a given task."""
        applicable_methods = []
        failed_plans = self.semantic_memory.get_related_facts(task.name, "has_failed_plan") or []

        for m in self.methods:
            if m.task.name == task.name:
                # Check if this method is part of a known failed plan
                is_failed = False
                for failed_plan in failed_plans:
                    if m.name in [step.name for step in failed_plan]:
                        is_failed = True
                        break
                if is_failed:
                    continue

                # In a real implementation, we would check preconditions here
                # e.g., if all(p(state) for p in m.preconditions):
                applicable_methods.append(m)
        return applicable_methods
