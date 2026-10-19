
"""
Distills knowledge from episodic memory into semantic memory.
"""

from .episodic_memory import EpisodicMemory
from .semantic_memory import SemanticMemory

import json
import os
from ..executors.htn.representation import state_to_vector, action_to_vector
from sklearn.cluster import DBSCAN
import numpy as np

class KnowledgeDistiller:
    """
    Analyzes episodic memory and distills it into the semantic memory.
    """

    def __init__(self, episodic_memory: EpisodicMemory, semantic_memory: SemanticMemory):
        self.episodic_memory = episodic_memory
        self.semantic_memory = semantic_memory
        self.training_data_path = os.path.join(os.path.dirname(__file__), 'training_data', 'world_model_data.jsonl')

    def distill_knowledge(self):
        """
        This process now saves vectorized experiences to a file for persistent learning
        and continues to perform skill discovery.
        """
        print("Distilling knowledge and saving training data...")
        experiences = self.episodic_memory.get_recent_experiences(100)
        
        os.makedirs(os.path.dirname(self.training_data_path), exist_ok=True)

        successful_plans = []
        with open(self.training_data_path, 'a') as f:
            for i in range(len(experiences) - 1):
                current_exp = experiences[i]
                next_exp = experiences[i+1]

                state, plan = current_exp
                next_state, _ = next_exp
                action = plan[0]

                # Convert to vectors
                state_vec = state_to_vector(state)
                action_vec = action_to_vector(action)
                next_state_vec = state_to_vector(next_state)

                # Save the vectorized experience as a JSON line
                data_point = {
                    'state': state_vec.tolist(),
                    'action': action_vec.tolist(),
                    'next_state': next_state_vec.tolist()
                }
                f.write(json.dumps(data_point) + '\n')

                if "404 Not Found" not in str(plan):
                    successful_plans.append((state, plan))

        # --- Trajectory Clustering for Skill Discovery ---
        if len(successful_plans) < 2:
            return

        action_vocab = {"open_browser": 0, "type_url": 1, "press_enter": 2}
        feature_vectors = []
        for state, plan in successful_plans:
            vec = np.zeros(len(action_vocab))
            for task in plan:
                if task.name in action_vocab:
                    vec[action_vocab[task.name]] += 1
            feature_vectors.append(vec)

        if not feature_vectors:
            return
            
        feature_vectors = np.array(feature_vectors)
        clustering = DBSCAN(eps=0.5, min_samples=2).fit(feature_vectors)
        labels = clustering.labels_

        # 3. Group plans by cluster label
        num_clusters = len(set(labels)) - (1 if -1 in labels else 0)
        if num_clusters > 0:
            print(f"Found {num_clusters} potential new skills from successful plans!")
            clusters = {i: [] for i in range(num_clusters)}
            for i, (state, plan) in enumerate(successful_plans):
                if labels[i] != -1:
                    clusters[labels[i]].append((state, plan))
            
            for cluster_id, state_plan_pairs in clusters.items():
                print(f"  Cluster {cluster_id}: {len(state_plan_pairs)} similar plans found.")
                self.abstract_and_store_skill(cluster_id, state_plan_pairs)

    def abstract_and_store_skill(self, cluster_id, state_plan_pairs):
        """Abstracts a new skill from a cluster of plans, including preconditions."""
        if not state_plan_pairs:
            return

        plans = [pair[1] for pair in state_plan_pairs]
        plan_sequences = [[task.name for task in plan] for plan in plans]
        lcs_sequence = self.find_lcs(plan_sequences)

        if not lcs_sequence:
            print(f"    -> Could not find a common subsequence for cluster {cluster_id}.")
            return

        # --- New: Learn Parameters ---
        learned_params = self.learn_parameters(plans)

        # --- New: Learn Preconditions ---
        initial_states = [pair[0] for pair in state_plan_pairs]
        learned_preconditions = self.learn_preconditions(initial_states)

        from ..executors.htn.planner import Task, Method
        abstract_plan = [Task(name=action_name) for action_name in lcs_sequence]

        new_skill_name = f"discovered_skill_{cluster_id}"
        # Task now takes parameters as **kwargs (name -> value); represent the
        # learned parameter names as keys with unbound (None) values.
        new_task = Task(name=new_skill_name, **{param: None for param in learned_params})
        new_method = Method(
            name=f"method_for_{new_skill_name}",
            task=new_task,
            preconditions=learned_preconditions,
            subtasks=abstract_plan
        )

        self.procedural_memory.add_skill(new_skill_name, [new_method])
        print(f"    -> Abstracted and stored new skill: '{new_skill_name}({', '.join(learned_params)})' with {len(learned_preconditions)} learned preconditions.")

    def learn_parameters(self, plans):
        """Learns the parameters of a skill by finding variable parameters in a set of plans."""
        if not plans or len(plans) < 2:
            return []

        # Use the first plan as a reference
        reference_plan = plans[0]
        skill_params = set()

        # Iterate through each task in the reference plan
        for i, ref_task in enumerate(reference_plan):
            # Check if this task exists at the same position in other plans
            if all(i < len(p) and p[i].name == ref_task.name for p in plans):
                # Check each parameter of the reference task
                for param_key, ref_value in ref_task.parameters.items():
                    # See if this parameter has different values in other plans
                    is_variable = False
                    for other_plan in plans:
                        other_task = other_plan[i]
                        if param_key not in other_task.parameters or other_task.parameters[param_key] != ref_value:
                            is_variable = True
                            break
                    if is_variable:
                        skill_params.add(param_key)
        
        return list(skill_params)

    def learn_preconditions(self, states):
        """Learns common preconditions from a list of initial states."""
        preconditions = []
        if not states:
            return preconditions

        # Learn boolean flag preconditions
        if all(s.is_browser_open for s in states):
            preconditions.append(lambda state: state.is_browser_open)
        elif all(not s.is_browser_open for s in states):
            preconditions.append(lambda state: not state.is_browser_open)

        # This logic could be extended to other state variables, like URL patterns, etc.

        return preconditions

    def find_lcs(self, sequences):
        """Finds the Longest Common Subsequence among a list of sequences."""
        if not sequences:
            return []
        
        # Start with the first sequence as the base for comparison
        lcs = sequences[0]
        for i in range(1, len(sequences)):
            lcs = self._lcs_pair(lcs, sequences[i])
        return lcs

    def _lcs_pair(self, seq1, seq2):
        """Finds the LCS of two sequences."""
        m, n = len(seq1), len(seq2)
        dp = [["" for _ in range(n + 1)] for _ in range(m + 1)]

        for i in range(m):
            for j in range(n):
                if seq1[i] == seq2[j]:
                    dp[i+1][j+1] = dp[i][j] + seq1[i]
                else:
                    dp[i+1][j+1] = max(dp[i+1][j], dp[i][j+1], key=len)
        
        # The result of LCS for strings is a string, we need to return a list of actions
        # This is a simplification, we assume action names don't have spaces.
        # The result dp[m][n] will be a single string of concatenated action names.
        # We need to reconstruct the list of action names.
        # This is a bit of a hack. A better dp table would store the lists directly.
        result_seq = []
        i, j = m, n
        while i > 0 and j > 0:
            if seq1[i-1] == seq2[j-1]:
                result_seq.append(seq1[i-1])
                i -= 1
                j -= 1
            elif len(dp[i-1][j]) > len(dp[i][j-1]):
                i -= 1
            else:
                j -= 1
        result_seq.reverse()
        return result_seq
