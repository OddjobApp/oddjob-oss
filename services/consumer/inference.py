
import numpy as np
import json

class BayesianInferenceEngine:
    """
    The Mathematical Core of the Ephemeral Semantic Context.
    Uses a Hidden Markov Model (HMM) to infer the user's cognitive state (S.C.O.R.E.)
    based on a sequence of observed behavioral pulses.
    """

    def __init__(self):
        # --- State Space Definition ---
        # S: Symptom (Problem Awareness)
        # C: Cause (Diagnosis)
        # O: Outcome (Goal Definition)
        # R: Resource (Tooling/Help)
        # E: Effect (Value Realization)
        self.states = ['S', 'C', 'O', 'R', 'E']
        self.state_indices = {s: i for i, s in enumerate(self.states)}
        
        # --- Transition Matrix (A) ---
        # P(State_t | State_t-1)
        # Row: From, Col: To
        # Modeled on the "Logical Levels of Change" flow: S -> C -> O -> R -> E
        self.transition_matrix = np.array([
            # S     C     O     R     E
            [0.60, 0.30, 0.05, 0.05, 0.00], # From S: Likely to move to Cause (Diagnosis)
            [0.10, 0.50, 0.30, 0.10, 0.00], # From C: Likely to move to Outcome (Solution)
            [0.05, 0.10, 0.50, 0.30, 0.05], # From O: Likely to move to Resource (Implementation)
            [0.05, 0.05, 0.10, 0.60, 0.20], # From R: Likely to move to Effect (Value) or stay in R
            [0.00, 0.00, 0.00, 0.10, 0.90], # From E: Stable state (Success)
        ])

        # --- Emission Matrix (B) ---
        # P(Observation | State)
        # "If I am in state S, how likely am I to see an 'S' vector pulse?"
        # High diagonal values mean reliable signals.
        self.emission_matrix = np.array([
            # Obs_S Obs_C Obs_O Obs_R Obs_E
            [0.85, 0.05, 0.05, 0.05, 0.00], # State S
            [0.10, 0.80, 0.05, 0.05, 0.00], # State C
            [0.05, 0.05, 0.80, 0.05, 0.05], # State O
            [0.05, 0.05, 0.05, 0.80, 0.05], # State R
            [0.00, 0.00, 0.05, 0.05, 0.90], # State E
        ])

    def get_initial_belief(self):
        """Returns a uniform prior distribution."""
        return np.array([0.2, 0.2, 0.2, 0.2, 0.2])

    def update_belief(self, current_belief, observed_vector, intensity=1.0):
        """
        Performs the Bayesian Update Step.
        Belief(t) = Normalize( Emission(Obs|State) * Sum( Transition(State|Prev) * Belief(t-1) ) )
        
        Args:
            current_belief (np.array): The prior probability vector (sum=1.0).
            observed_vector (str): The observed pulse vector ('S', 'C', etc.).
            intensity (float): Scalar multiplier for the observation's weight (simulates confidence).
        """
        if observed_vector not in self.state_indices:
            # If unknown vector, decay belief by mixing with uniform (entropy increase)
            decay_factor = 0.1
            uniform = self.get_initial_belief()
            return (current_belief * (1 - decay_factor)) + (uniform * decay_factor)

        obs_idx = self.state_indices[observed_vector]
        
        # 1. Prediction Step (Project forward based on Transition Matrix)
        # predicted_belief = current_belief @ self.transition_matrix
        predicted_belief = np.dot(current_belief, self.transition_matrix)

        # 2. Update Step (Correct based on Observation)
        # likelihood = P(Observation | State)
        likelihood = self.emission_matrix[:, obs_idx]
        
        # Apply intensity: If intensity > 1, we sharpen the likelihood.
        # If intensity < 1, we flatten it (more uncertainty).
        if intensity != 1.0:
            likelihood = np.power(likelihood, intensity)

        unnormalized_posterior = likelihood * predicted_belief

        # 3. Normalization
        posterior = unnormalized_posterior / np.sum(unnormalized_posterior)
        
        return posterior

    def get_dominant_state(self, belief_vector):
        """Returns the state with the highest probability and its score."""
        max_idx = np.argmax(belief_vector)
        return self.states[max_idx], belief_vector[max_idx]
