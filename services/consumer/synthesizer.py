
import json
import os

class ContextSynthesizer:
    """
    The Bridge between the Mathematical State and the LLM.
    Synthesizes TWO outputs:
    1. user_text - Friendly message shown to the user in the popup
    2. agent_prompt - Detailed technical prompt for the AI agent (hidden from user)
    
    Enhanced to include rich UI context from the frontend pulse emitter.
    """
    
    def __init__(self, library_path='pta_library.json', redis_client=None):
        self.library = {}
        self.redis_client = redis_client
        self.interventions_cache = []
        self.last_cache_update = 0
        try:
            with open(library_path, 'r') as f:
                self.library = json.load(f)
        except Exception as e:
            print(f"[Synthesizer] Failed to load library: {e}")

    def _get_interventions(self):
        # Refresh cache every minute, or listen for pub/sub (handled by updates elsewhere, simple polling here)
        import time
        if self.redis_client and (time.time() - self.last_cache_update > 60):
            try:
                data = self.redis_client.get('psychologist:interventions')
                if data:
                    self.interventions_cache = json.loads(data)
                    self.last_cache_update = time.time()
            except Exception as e:
                print(f"[Synthesizer] Failed to load interventions: {e}")
        return self.interventions_cache
    
    def _find_intervention(self, state, confidence, ctx, element):
        interventions = self._get_interventions()
        for iv in interventions:
            # 1. Check enabled
            if not iv.get('enabled', True):
                continue
            
            # 2. Check State
            if iv['conditionState'] != state:
                continue

            # 3. Check Confidence
            if confidence < iv['conditionConfidenceThreshold']:
                continue

            # 4. Check Context (Optional)
            if iv.get('conditionContextKey'):
                key = iv['conditionContextKey']
                required_val = iv.get('conditionContextValue')
                
                actual_val = ctx.get(key)
                # If key is 'element_id', we might check 'element'
                if key == 'element_id' and element != required_val:
                    continue
                elif key != 'element_id' and actual_val != required_val:
                    continue
            
            return iv
        return None

    def synthesize_prompt(self, state, pulse_context, confidence=0.8): # Added confidence arg
        """
        Constructs both user-facing and agent-facing messages with rich context.
        
        Returns:
            dict with:
                - strategy_name: Name of the strategy
                - tone: The tone for the response
                - user_text: Friendly message for the popup (visible to user)
                - user_cta: Call-to-action button text
                - agent_prompt: Full technical prompt for LLM (hidden from user)
                - context: Rich context bundle for the agent
        """
        strategy = self.library.get('strategies', {}).get(state)
        if not strategy:
            return None

        # Extract context from pulse
        route = pulse_context.get('r_path', 'unknown')
        route_desc = pulse_context.get('r_desc', route)
        element = pulse_context.get('act_id', None)
        nlp_description = pulse_context.get('nlpDescription', '')
        ctx = pulse_context.get('ctx', {})
        
        # Build rich context description
        context_parts = []
        
        # Check for dynamic intervention override
        intervention = self._find_intervention(state, confidence, ctx, element)
        
        # Screen/Route context
        context_parts.append(f"User is on the **{route_desc}** page.")
        
        # Section context
        if ctx.get('section'):
            section_map = {
                'dialog': 'in a modal dialog',
                'drawer': 'in a side panel',
                'aside': 'using the sidebar',
                'header': 'using the top header',
                'main': 'in the main content area'
            }
            section_desc = section_map.get(ctx['section'], f"in the {ctx['section']} section")
            context_parts.append(section_desc)
        
        # Card context
        if ctx.get('card_type'):
            card_label = ctx.get('card_label', '')
            if card_label:
                context_parts.append(f"Looking at '{card_label}' ({ctx['card_type']})")
            else:
                context_parts.append(f"Interacting with a {ctx['card_type']}")
        
        # Tab context
        if ctx.get('tab_name'):
            context_parts.append(f"On the '{ctx['tab_name']}' tab")
        
        # Modal context
        if ctx.get('is_modal') and ctx.get('modal_title'):
            context_parts.append(f"Focused on the '{ctx['modal_title']}' modal")
        
        # Element/Action context
        if ctx.get('element_label'):
            context_parts.append(f"Interacted with '{ctx['element_label']}'")
        elif element and element != 'ambient_dwell' and element != 'user_idle_10s':
            context_parts.append(f"Last action: {element}")
        
        # Data context
        data_refs = []
        if ctx.get('job_id'):
            data_refs.append(f"Job #{ctx['job_id']}")
        if ctx.get('pipeline_id'):
            data_refs.append(f"Pipeline #{ctx['pipeline_id']}")
        if ctx.get('alert_id'):
            data_refs.append(f"Alert #{ctx['alert_id']}")
        if data_refs:
            context_parts.append(f"Working with: {', '.join(data_refs)}")
        
        # Input context
        if ctx.get('input_name'):
            context_parts.append(f"Editing field: '{ctx['input_name']}'")
        
        # Idle context (stalling indicator)
        if element == 'user_idle_10s' or ctx.get('idle_context'):
            context_parts.append("**User has been idle for 10+ seconds** (may be confused or stuck)")
        
        # Inferred NLP description from ingestor
        if nlp_description and nlp_description != route:
            context_parts.append(f"Activity summary: {nlp_description}")
        
        # Build the full context string
        context_string = "\n- ".join(context_parts) if context_parts else f"On route '{route}'"
        
        # Get MCP tool suggestions for this strategy
        mcp_tools = strategy.get('mcp_tools', [])
        mcp_tools_hint = ""
        if mcp_tools:
            mcp_tools_hint = f"\n\n## Suggested MCP Tools for This Situation\n- " + "\n- ".join(mcp_tools)
        
        # Get card-specific hint if available
        card_hint = ""
        card_hints = strategy.get('card_hints', {})
        card_type = ctx.get('card_type', '')
        if card_type and card_type in card_hints:
            card_hint = f"\n\n## Card-Specific Guidance\n{card_hints[card_type]}"
        
        # Get screen-specific hint if available
        screen_hint = ""
        screen_hints = self.library.get('screen_hints', {})
        if route in screen_hints:
            sh = screen_hints[route]
            screen_hint = f"\n\n## Screen Context\n{sh.get('description', '')}\nLikely Intent: {sh.get('likely_intent', '')}"
        elif '/jobs/' in route and ':id' in str(screen_hints.keys()):
            # Handle dynamic routes
            sh = screen_hints.get('/jobs/:id', {})
            if sh:
                screen_hint = f"\n\n## Screen Context\n{sh.get('description', '')}\nLikely Intent: {sh.get('likely_intent', '')}"
        
        # 1. User-facing message (can be state-specific or context-aware)
        user_text = self._generate_user_message(state, ctx, element)
        user_cta = strategy.get('user_cta', 'Get help')
        
        # Override if intervention found
        effect_type = 'popup'
        effect_target = None
        
        if intervention:
            # Effect
            effect_type = intervention.get('effectType', 'popup')
            effect_target = intervention.get('effectTargetSelector')
            
            # Templates
            if intervention.get('userMessageTemplate'):
                user_text = intervention['userMessageTemplate'].replace('{element}', str(element or 'this item'))
                # Could extend with more template vars
            
            if intervention.get('aiPromptTemplate'):
                # Override or append? Let's prepend to the system instruction later
                pass

        # 2. Full agent prompt with rich context and tool suggestions
        system_instruction = strategy.get('system_prompt', '')
        
        if intervention and intervention.get('aiPromptTemplate'):
             system_instruction = f"{intervention['aiPromptTemplate'].replace('{element}', str(element or 'this item'))}\n\n{system_instruction}"

        agent_prompt = f"""{system_instruction}

## Current User Context
- {context_string}

## User State
- Cognitive State: **{state}** ({strategy.get('name')})
- This means: {strategy.get('goal')}
- Recommended tone: {strategy.get('tone')}
{screen_hint}
{card_hint}
{mcp_tools_hint}

## Your Task
Generate a helpful, actionable response in {strategy.get('max_tokens', 50)} tokens or less.
Be specific to their current screen and activity. Reference actual elements they're working with.
Do NOT be generic - use the context above to provide targeted assistance.
If applicable, use the suggested MCP tools to provide concrete help."""

        return {
            "strategy_name": strategy.get('name'),
            "tone": strategy.get('tone'),
            "user_text": user_text,
            "user_cta": user_cta,
            "agent_prompt": agent_prompt,
            "context": {
                "route": route,
                "route_desc": route_desc,
                "element": element,
                "state": state,
                "ui_context": ctx,
                "nlp_summary": nlp_description,
                "intervention_id": intervention.get('id') if intervention else None
            },
            "effect_type": effect_type,
            "effect_target": effect_target
        }
    
    def _generate_user_message(self, state, ctx, element):
        """
        Generate a context-aware user message based on state and UI context.
        """
        strategy = self.library.get('strategies', {}).get(state, {})
        base_message = strategy.get('user_message', 'I noticed you might need some help.')
        
        # Make message more specific based on context
        if element == 'user_idle_10s':
            if ctx.get('modal_title'):
                return f"Need help with '{ctx['modal_title']}'? I can assist."
            elif ctx.get('card_label'):
                return f"Stuck on '{ctx['card_label']}'? Let me help."
            elif ctx.get('tab_name'):
                return f"Need help with the {ctx['tab_name']} settings?"
            else:
                return base_message
        
        if ctx.get('button_intent') == 'destructive':
            return "Before you delete this, want me to check if it's safe?"
        
        if ctx.get('card_type') == 'alert-card':
            return "I can help you investigate this alert."
        
        if ctx.get('input_name'):
            return f"Need help filling out the '{ctx['input_name']}' field?"
        
        return base_message
