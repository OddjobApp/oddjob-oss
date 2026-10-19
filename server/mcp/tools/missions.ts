/**
 * Oddjob MCP Server - Mission Tools
 * 
 * Exposes tools for managing missions through the Model Context Protocol.
 * Missions are dynamic, mission-bound entities that group agents and pipelines.
 */

import { z } from "zod";

export const missionToolDefinitions = [
    {
        name: "list_missions",
        description: "List all missions in the organization. Missions represent active or historical multi-agent missions and their objectives.",
        inputSchema: {
            type: "object" as const,
            properties: {
                orgId: {
                    type: "number",
                    description: "Optional: Organization ID to filter by",
                },
                limit: {
                    type: "number",
                    description: "Maximum results. Default: 20",
                },
            },
        },
    },
    {
        name: "get_mission_details",
        description: "Get detailed information about a mission, including its objective, blackboard state, members (recruited agents), and active runs.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: {
                    type: "number",
                    description: "ID of the mission",
                },
            },
            required: ["missionId"],
        },
    },
    {
        name: "update_mission",
        description: "Update mission metadata, such as the objective or blackboard state (shared mission memory).",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number" },
                name: { type: "string" },
                objective: { type: "string" },
                blackboard: { type: "object", description: "Updated shared memory object" },
            },
            required: ["missionId"],
        },
    },
    {
        name: "update_blackboard",
        description: "Update the shared 'blackboard' for your mission. Use this to share findings, plans, or status updates with other agents in the same mission.",
        inputSchema: {
            type: "object" as const,
            properties: {
                content: {
                    type: "object",
                    description: "JSON object containing the data to store on the blackboard",
                    additionalProperties: true
                },
                reason: {
                    type: "string",
                    description: "Reason for the update (e.g. 'Found new credentials', 'Completed step 1')"
                }
            },
            required: ["content", "reason"]
        }
    },
    {
        name: "get_blackboard",
        description: "Retrieve the current content of the shared mission blackboard.",
        inputSchema: {
            type: "object" as const,
            properties: {}
        }
    },
    {
        name: "get_mission_status",
        description: "Get real-time status of a mission run including execution progress, timeout info, and remaining time.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: {
                    type: "number",
                    description: "ID of the mission run to check status for",
                },
            },
            required: ["missionRunId"],
        },
    },
    {
        name: "add_shared_memory",
        description: "Share an observation with other agents in your mission. Use when you discover something useful (e.g. 'Found API key in credential ID 5', 'Competitor X uses pricing model Y'). Other agents can use this context.",
        inputSchema: {
            type: "object" as const,
            properties: {
                observation: {
                    type: "string",
                    description: "What you discovered or learned (concise, actionable)"
                },
                source: {
                    type: "string",
                    description: "Your identifier (e.g. 'job-7', 'agent-researcher')"
                }
            },
            required: ["observation"]
        }
    },
    {
        name: "launch_mission",
        description: "Trigger the execution of the Mission. This will start the Supervisor pipeline which delegates tasks to members based on the active Objective.",
        inputSchema: {
            type: "object" as const,
            properties: {
                reason: {
                    type: "string",
                    description: "Why you are launching this mission (e.g. 'User requested start', 'Conditions met')"
                }
            },
            required: ["reason"]
        }
    },
    {
        name: "apply_recovery_decision",
        description: "Executes a recovery strategy (retry, replan, relax, stop) on an active mission run after a human decision.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: {
                    type: "number",
                    description: "The ID of the mission run to recover"
                },
                strategy: {
                    type: "string",
                    enum: ["accept_proposal", "retry", "replan", "safe_state", "reset"],
                    description: "The recovery strategy to apply"
                },
                customInstructions: {
                    type: "string",
                    description: "Additional instructions for the agent during recovery"
                }
            },
            required: ["missionRunId", "strategy"]
        }
    },
    {
        name: "create_mission",
        description: "Create a new mission with name, objective, and optional execution strategy.",
        inputSchema: {
            type: "object" as const,
            properties: {
                name: {
                    type: "string",
                    description: "Name of the mission"
                },
                objective: {
                    type: "string",
                    description: "Clear description of what the mission should accomplish"
                },
                executionStrategy: {
                    type: "string",
                    enum: ["pre_planned", "dynamic_autonomous", "rolling_wave"],
                    description: "Execution strategy: pre_planned (pipeline sequence), dynamic_autonomous (AI-driven), or rolling_wave (vibecoding)"
                },
                orgId: {
                    type: "number",
                    description: "Organization ID. Defaults to current org"
                }
            },
            required: ["name", "objective"]
        }
    },
    {
        name: "delete_mission",
        description: "Delete a mission and all its associated data.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: {
                    type: "number",
                    description: "ID of the mission to delete"
                }
            },
            required: ["missionId"]
        }
    },
    {
        name: "plan_mission",
        description: "Use AI to generate a mission plan based on a prompt. Returns suggested agents, pipelines, and structure.",
        inputSchema: {
            type: "object" as const,
            properties: {
                prompt: {
                    type: "string",
                    description: "Description of what you want to accomplish"
                },
                history: {
                    type: "array",
                    description: "Optional previous planning attempts for context",
                    items: { type: "object" }
                }
            },
            required: ["prompt"]
        }
    },
    {
        name: "list_mission_templates",
        description: "List available mission templates that can be instantiated.",
        inputSchema: {
            type: "object" as const,
            properties: {
                orgId: {
                    type: "number",
                    description: "Optional organization ID to filter by"
                }
            }
        }
    },
    {
        name: "instantiate_mission_template",
        description: "Create a new mission from a template.",
        inputSchema: {
            type: "object" as const,
            properties: {
                templateId: {
                    type: "number",
                    description: "ID of the template to instantiate"
                },
                name: {
                    type: "string",
                    description: "Name for the new mission"
                },
                customizations: {
                    type: "object",
                    description: "Optional customizations to apply to the template",
                    additionalProperties: true
                }
            },
            required: ["templateId", "name"]
        }
    },
    {
        name: "chat_with_mission",
        description: "Send a message to an active mission. Mission Control AI will respond based on current mission state.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: {
                    type: "number",
                    description: "ID of the mission"
                },
                message: {
                    type: "string",
                    description: "Your message or question to Mission Control"
                }
            },
            required: ["missionId", "message"]
        }
    },
    {
        name: "get_mission_memories",
        description: "Retrieve shared memories for a mission. Memories persist across runs and capture key learnings.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: {
                    type: "number",
                    description: "ID of the mission"
                },
                limit: {
                    type: "number",
                    description: "Maximum memories to return"
                }
            },
            required: ["missionId"]
        }
    },
    {
        name: "get_mission_timeline",
        description: "Get checkpoint timeline for a mission run including all status changes and blackboard updates.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: {
                    type: "number",
                    description: "ID of the mission run"
                },
                limit: {
                    type: "number",
                    description: "Maximum timeline entries to return"
                }
            },
            required: ["missionRunId"]
        }
    },
    {
        name: "get_mission_activity",
        description: "Get activity stream for a mission including all events and updates.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: {
                    type: "number",
                    description: "ID of the mission"
                }
            },
            required: ["missionId"]
        }
    },
    {
        name: "promote_shadow_run",
        description: "Promote a shadow run to a master blueprint/template.",
        inputSchema: {
            type: "object" as const,
            properties: {
                shadowRunId: {
                    type: "number",
                    description: "ID of the shadow run to promote"
                },
                name: {
                    type: "string",
                    description: "Name for the new blueprint"
                },
                description: {
                    type: "string",
                    description: "Description of the blueprint"
                }
            },
            required: ["shadowRunId", "name"]
        }
    },
    {
        name: "get_mission_suggestions",
        description: "Get AI-generated suggestions for improving a mission or recovering from failure.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: {
                    type: "number",
                    description: "ID of the mission"
                }
            },
            required: ["missionId"]
        }
    },
    {
        name: "update_mission_members",
        description: "Add or remove agents/pipelines from a mission.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: {
                    type: "number",
                    description: "ID of the mission"
                },
                addMembers: {
                    type: "array",
                    description: "Members to add",
                    items: {
                        type: "object",
                        properties: {
                            entityType: { type: "string", enum: ["pipeline", "job"] },
                            entityId: { type: "number" },
                            role: { type: "string" }
                        }
                    }
                },
                removeMemberIds: {
                    type: "array",
                    description: "Member IDs to remove",
                    items: { type: "number" }
                }
            },
            required: ["missionId"]
        }
    },
    {
        name: "get_mission_replay_history",
        description: "Get checkpoint history for a mission run to see all execution snapshots for replay/debugging.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: { type: "number", description: "ID of the mission run to get history for" }
            },
            required: ["missionRunId"]
        }
    },
    {
        name: "replay_mission_from_checkpoint",
        description: "Replay a mission run starting from a specific checkpoint with optional parameter modifications.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: { type: "number", description: "Original mission run ID" },
                checkpointId: { type: "number", description: "Checkpoint ID to replay from" },
                modifyParameters: { type: "object", description: "Optional parameter overrides for replay" },
                dryRun: { type: "boolean", description: "If true, create replay run but don't start execution" }
            },
            required: ["missionRunId", "checkpointId"]
        }
    },
    {
        name: "compare_mission_runs",
        description: "Compare two mission runs to identify divergence points and differences.",
        inputSchema: {
            type: "object" as const,
            properties: {
                runIdA: { type: "number", description: "First mission run ID" },
                runIdB: { type: "number", description: "Second mission run ID" }
            },
            required: ["runIdA", "runIdB"]
        }
    },
    {
        name: "get_mission_execution_heatmap",
        description: "Get execution time breakdown by phase and tool for a mission run.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: { type: "number", description: "Mission run ID to analyze" }
            },
            required: ["missionRunId"]
        }
    },
    {
        name: "start_mission_debug_session",
        description: "Start a debug session for a mission run to enable step-through debugging.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: { type: "number", description: "Mission run ID to debug" },
                autoPauseOnStart: { type: "boolean", description: "Pause immediately when debug starts" }
            },
            required: ["missionRunId"]
        }
    },
    {
        name: "pause_mission",
        description: "Pause mission execution at the next opportunity.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: { type: "number", description: "Mission run ID to pause" }
            },
            required: ["missionRunId"]
        }
    },
    {
        name: "resume_mission",
        description: "Resume paused mission execution.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: { type: "number", description: "Mission run ID to resume" }
            },
            required: ["missionRunId"]
        }
    },
    {
        name: "step_mission",
        description: "Execute next step and pause (step-through debugging).",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: { type: "number", description: "Mission run ID" },
                stepType: { type: "string", enum: ["over", "into", "out"], description: "Step type: over (skip into), into (dive deeper), out (finish current)" }
            },
            required: ["missionRunId"]
        }
    },
    {
        name: "inspect_mission_state",
        description: "Inspect current mission blackboard and variables when paused.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: { type: "number", description: "Mission run ID to inspect" }
            },
            required: ["missionRunId"]
        }
    },
    {
        name: "modify_mission_variable",
        description: "Modify a variable in the mission blackboard while paused (debug mode only).",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: { type: "number", description: "Mission run ID" },
                path: { type: "string", description: "Variable path in dot notation (e.g., 'blackboard.key')" },
                value: { type: "any", description: "New value to set" }
            },
            required: ["missionRunId", "path", "value"]
        }
    },
    {
        name: "add_mission_breakpoint",
        description: "Add a breakpoint to pause execution at specific conditions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: { type: "number", description: "Mission run ID" },
                type: { type: "string", enum: ["tool_call", "phase_change", "blackboard_update", "condition"], description: "Breakpoint type" },
                target: { type: "string", description: "Target tool name, phase, or key to watch" },
                condition: { type: "string", description: "Optional condition expression" },
                enabled: { type: "boolean", description: "Whether breakpoint is active" }
            },
            required: ["missionRunId", "type"]
        }
    },
    {
        name: "remove_mission_breakpoint",
        description: "Remove a breakpoint from a mission.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionRunId: { type: "number", description: "Mission run ID" },
                breakpointId: { type: "string", description: "Breakpoint ID to remove" }
            },
            required: ["missionRunId", "breakpointId"]
        }
    },
    {
        name: "get_circuit_breaker_status",
        description: "Get circuit breaker status for tools. Shows which tools have open circuits and failure statistics.",
        inputSchema: {
            type: "object" as const,
            properties: {
                toolName: { type: "string", description: "Optional: specific tool to check. If omitted, returns all circuits." }
            }
        }
    },
    {
        name: "reset_circuit_breaker",
        description: "Reset circuit breaker for a tool or all tools. Use when a tool has recovered and should be retried.",
        inputSchema: {
            type: "object" as const,
            properties: {
                toolName: { type: "string", description: "Tool to reset. If omitted, resets all circuits." }
            }
        }
    },
    {
        name: "configure_circuit_breaker",
        description: "Configure circuit breaker thresholds for a tool.",
        inputSchema: {
            type: "object" as const,
            properties: {
                toolName: { type: "string", description: "Tool name to configure" },
                failureThreshold: { type: "number", description: "Failures before opening circuit" },
                recoveryTimeout: { type: "number", description: "Milliseconds before recovery attempt" },
                halfOpenMaxCalls: { type: "number", description: "Max test calls in half-open state" },
                successThreshold: { type: "number", description: "Successes needed to close circuit" }
            },
            required: ["toolName"]
        }
    },
    {
        name: "get_dead_letter_queue",
        description: "Get failed operations that exhausted all retry attempts. Shows tool failures that need manual intervention.",
        inputSchema: {
            type: "object" as const,
            properties: {
                toolName: { type: "string", description: "Filter by specific tool" },
                limit: { type: "number", description: "Max entries to return (default 20)" },
                since: { type: "string", description: "ISO date string to filter from" }
            }
        }
    },
    {
        name: "replay_dead_letter",
        description: "Replay a failed operation from the dead letter queue. Use when root cause has been fixed.",
        inputSchema: {
            type: "object" as const,
            properties: {
                entryId: { type: "string", description: "Dead letter entry ID to replay" }
            },
            required: ["entryId"]
        }
    },
    {
        name: "remove_dead_letter",
        description: "Remove an entry from the dead letter queue. Use for acknowledged/resolved failures.",
        inputSchema: {
            type: "object" as const,
            properties: {
                entryId: { type: "string", description: "Dead letter entry ID to remove" }
            },
            required: ["entryId"]
        }
    },
    {
        name: "get_retry_stats",
        description: "Get retry service statistics including active retries and dead letter queue size.",
        inputSchema: {
            type: "object" as const,
            properties: {}
        }
    },
    {
        name: "add_mission_dependency",
        description: "Create a dependency between missions. Source mission waits for target mission to complete before starting.",
        inputSchema: {
            type: "object" as const,
            properties: {
                sourceMissionId: { type: "number", description: "Mission that will wait/trigger" },
                targetMissionId: { type: "number", description: "Mission that must complete first" },
                type: { type: "string", enum: ["sequential", "fan_out", "fan_in", "any_of", "all_of"], description: "Dependency type" },
                condition: { type: "string", enum: ["completed", "succeeded", "failed", "any"], description: "Completion condition" }
            },
            required: ["sourceMissionId", "targetMissionId"]
        }
    },
    {
        name: "remove_mission_dependency",
        description: "Remove a dependency between missions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                dependencyId: { type: "string", description: "Dependency ID to remove" }
            },
            required: ["dependencyId"]
        }
    },
    {
        name: "get_mission_dependencies",
        description: "Get all dependencies for a mission (what it depends on and what depends on it).",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID to query" }
            },
            required: ["missionId"]
        }
    },
    {
        name: "get_dependency_graph",
        description: "Get the dependency graph for visualizing mission relationships and detecting cycles.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionIds: { type: "array", items: { type: "number" }, description: "Optional: filter to specific missions" }
            }
        }
    },
    {
        name: "check_dependencies_satisfied",
        description: "Check if all dependencies for a mission are satisfied and it's ready to run.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID to check" }
            },
            required: ["missionId"]
        }
    },
    {
        name: "get_execution_order",
        description: "Get the optimal execution order for a set of missions based on dependencies (topological sort).",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionIds: { type: "array", items: { type: "number" }, description: "Mission IDs to order" }
            },
            required: ["missionIds"]
        }
    },
    {
        name: "create_mission_workflow",
        description: "Create a complex workflow with multiple missions and dependencies in one operation.",
        inputSchema: {
            type: "object" as const,
            properties: {
                name: { type: "string", description: "Workflow name" },
                definition: { 
                    type: "array", 
                    description: "Workflow steps with dependencies",
                    items: {
                        type: "object",
                        properties: {
                            missionId: { type: "number" },
                            dependsOn: { type: "array", items: { type: "number" } },
                            type: { type: "string", enum: ["sequential", "fan_out", "fan_in", "any_of", "all_of"] },
                            condition: { type: "string", enum: ["completed", "succeeded", "failed", "any"] }
                        }
                    }
                }
            },
            required: ["name", "definition"]
        }
    },
    {
        name: "get_mission_workflows",
        description: "Get all defined mission workflows.",
        inputSchema: {
            type: "object" as const,
            properties: {}
        }
    },
    {
        name: "generate_mission_plan",
        description: "Generate AI-powered mission plan with tool recommendations, time estimates, and risk assessment based on objective.",
        inputSchema: {
            type: "object" as const,
            properties: {
                objective: { type: "string", description: "Mission objective to plan for" },
                orgId: { type: "number", description: "Optional: filter to organization's mission history" },
                considerHistory: { type: "boolean", description: "Whether to consider similar past missions (default true)" },
                maxSuggestions: { type: "number", description: "Max number of suggestions (1-10, default 5)" }
            },
            required: ["objective"]
        }
    },
    {
        name: "get_mission_patterns",
        description: "Get known mission patterns for common use cases like data processing, API integration, etc.",
        inputSchema: {
            type: "object" as const,
            properties: {}
        }
    },
    {
        name: "get_tool_recommendations",
        description: "Get AI-recommended tools for a mission objective based on historical effectiveness.",
        inputSchema: {
            type: "object" as const,
            properties: {
                objective: { type: "string", description: "Mission objective" }
            },
            required: ["objective"]
        }
    },
    {
        name: "estimate_mission_completion",
        description: "Estimate completion time for a mission with given pipeline sequence.",
        inputSchema: {
            type: "object" as const,
            properties: {
                objective: { type: "string", description: "Mission objective" },
                pipeline: { type: "array", items: { type: "string" }, description: "Array of tool names in sequence" }
            },
            required: ["objective", "pipeline"]
        }
    },
    {
        name: "assess_mission_risk",
        description: "Assess risk factors for a mission and get mitigation suggestions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                objective: { type: "string", description: "Mission objective" },
                pipeline: { type: "array", items: { type: "string" }, description: "Optional: pipeline to assess" }
            },
            required: ["objective"]
        }
    },
    {
        name: "find_similar_missions",
        description: "Find historically similar missions for learning from past outcomes.",
        inputSchema: {
            type: "object" as const,
            properties: {
                objective: { type: "string", description: "Mission objective to match" },
                orgId: { type: "number", description: "Optional: organization filter" },
                limit: { type: "number", description: "Max results (1-20, default 5)" }
            },
            required: ["objective"]
        }
    },
    {
        name: "get_self_healing_stats",
        description: "Get self-healing service statistics including resolved, escalated, and failed attempts.",
        inputSchema: {
            type: "object" as const,
            properties: {}
        }
    },
    {
        name: "get_failure_patterns",
        description: "Get known failure patterns that can be auto-remediated.",
        inputSchema: {
            type: "object" as const,
            properties: {}
        }
    },
    {
        name: "get_active_escalations",
        description: "Get escalations awaiting human intervention.",
        inputSchema: {
            type: "object" as const,
            properties: {
                status: { type: "string", enum: ["pending", "acknowledged", "resolved"], description: "Filter by status" }
            }
        }
    },
    {
        name: "acknowledge_escalation",
        description: "Acknowledge an escalation that requires human intervention.",
        inputSchema: {
            type: "object" as const,
            properties: {
                escalationId: { type: "string", description: "Escalation ID to acknowledge" },
                response: { type: "string", description: "Optional human response/notes" }
            },
            required: ["escalationId"]
        }
    },
    {
        name: "resolve_escalation",
        description: "Resolve an escalation with the fix applied.",
        inputSchema: {
            type: "object" as const,
            properties: {
                escalationId: { type: "string", description: "Escalation ID to resolve" },
                resolution: { type: "string", description: "Description of fix applied" },
                learnPattern: { type: "boolean", description: "Learn from this resolution for future auto-healing" }
            },
            required: ["escalationId", "resolution"]
        }
    },
    {
        name: "create_agent",
        description: "Create a specialized agent for multi-agent mission coordination.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" },
                name: { type: "string", description: "Agent name" },
                role: { type: "string", enum: ["planner", "executor", "reviewer", "specialist", "coordinator"], description: "Agent role" },
                specialties: { type: "array", items: { type: "string" }, description: "Optional custom specialties" }
            },
            required: ["missionId", "name", "role"]
        }
    },
    {
        name: "get_agents",
        description: "Get all agents for a mission.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" }
            },
            required: ["missionId"]
        }
    },
    {
        name: "send_agent_message",
        description: "Send a message between agents.",
        inputSchema: {
            type: "object" as const,
            properties: {
                fromAgentId: { type: "string", description: "Sending agent ID" },
                toAgentId: { type: "string", description: "Recipient agent ID (omit to broadcast)" },
                type: { type: "string", enum: ["task_assignment", "review_request", "review_feedback", "consensus_proposal", "consensus_vote", "conflict_notification", "information_share", "decision_request", "status_update"], description: "Message type" },
                content: { type: "string", description: "Message content" },
                priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Message priority" },
                requiresResponse: { type: "boolean", description: "Whether response is required" }
            },
            required: ["fromAgentId", "type", "content"]
        }
    },
    {
        name: "create_consensus_proposal",
        description: "Create a consensus proposal for agents to vote on.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" },
                proposedBy: { type: "string", description: "Proposing agent ID" },
                topic: { type: "string", description: "Proposal topic" },
                proposal: { type: "string", description: "Proposal description" },
                options: { type: "array", items: { type: "string" }, description: "Voting options" },
                deadline: { type: "string", description: "ISO date deadline (optional)" },
                conclusionThreshold: { type: "number", description: "Agreement threshold 0.5-1.0 (default 0.7)" }
            },
            required: ["missionId", "proposedBy", "topic", "proposal", "options"]
        }
    },
    {
        name: "cast_consensus_vote",
        description: "Cast a vote on a consensus proposal.",
        inputSchema: {
            type: "object" as const,
            properties: {
                consensusId: { type: "string", description: "Consensus proposal ID" },
                agentId: { type: "string", description: "Voting agent ID" },
                option: { type: "string", description: "Selected option" }
            },
            required: ["consensusId", "agentId", "option"]
        }
    },
    {
        name: "assign_agent_task",
        description: "Assign a task to an agent.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" },
                assignedBy: { type: "string", description: "Assigning agent ID" },
                assignedTo: { type: "string", description: "Assigned agent ID" },
                description: { type: "string", description: "Task description" },
                priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Task priority" },
                deadline: { type: "string", description: "ISO date deadline" },
                reviewBy: { type: "string", description: "Reviewer agent ID" }
            },
            required: ["missionId", "assignedBy", "assignedTo", "description"]
        }
    },
    {
        name: "update_agent_task_status",
        description: "Update the status of an agent task.",
        inputSchema: {
            type: "object" as const,
            properties: {
                taskId: { type: "string", description: "Task ID" },
                status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "blocked"], description: "New status" },
                result: { type: "object", description: "Task result data" }
            },
            required: ["taskId", "status"]
        }
    },
    {
        name: "detect_conflict",
        description: "Detect and record a conflict between agents.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" },
                agents: { type: "array", items: { type: "string" }, description: "Agent IDs involved" },
                type: { type: "string", enum: ["task_dispute", "resource_contention", "approach_disagreement", "priority_conflict", "deadlock"], description: "Conflict type" },
                description: { type: "string", description: "Conflict description" },
                severity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Conflict severity" }
            },
            required: ["missionId", "agents", "type", "description"]
        }
    },
    {
        name: "get_mission_coordination_stats",
        description: "Get multi-agent coordination statistics for a mission.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" }
            },
            required: ["missionId"]
        }
    },
    {
        name: "create_coordinator_pool",
        description: "Create or reuse a coordinator and role-based worker pool around a complex mission goal.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" },
                goal: { type: "string", description: "Complex goal for the agent pool" },
                requiredRoles: {
                    type: "array",
                    items: { type: "string", enum: ["planner", "executor", "reviewer", "specialist", "coordinator"] },
                    description: "Agent roles required for the pool"
                },
                seedTasks: {
                    type: "array",
                    description: "Optional initial tasks to assign to matching roles",
                    items: {
                        type: "object",
                        properties: {
                            description: { type: "string" },
                            role: { type: "string", enum: ["planner", "executor", "reviewer", "specialist", "coordinator"] },
                            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
                            dependencies: { type: "array", items: { type: "string" } },
                            deliverables: { type: "array", items: { type: "string" } }
                        },
                        required: ["description"]
                    }
                },
                postGoalToBlackboard: { type: "boolean", description: "Whether to publish the goal to the shared blackboard" }
            },
            required: ["missionId", "goal", "requiredRoles"]
        }
    },
    {
        name: "post_agent_blackboard_item",
        description: "Post a shared coordination item to a mission agent blackboard.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" },
                postedBy: { type: "string", description: "Posting agent ID" },
                topic: { type: "string", description: "Blackboard topic" },
                content: { type: "string", description: "Blackboard content" },
                type: { type: "string", enum: ["goal", "observation", "hypothesis", "request", "result", "constraint", "affordance", "meta_trajectory"], description: "Blackboard item type" },
                priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Item priority" },
                visibility: { type: "string", enum: ["mission", "role", "agent"], description: "Who can see this item" },
                targetRole: { type: "string", enum: ["planner", "executor", "reviewer", "specialist", "coordinator"], description: "Required for role visibility" },
                targetAgentId: { type: "string", description: "Required for agent visibility" },
                tags: { type: "array", items: { type: "string" }, description: "Search/filter tags" },
                context: { type: "object", description: "Optional structured context" },
                expiresAt: { type: "string", description: "Optional ISO expiration timestamp" }
            },
            required: ["missionId", "postedBy", "topic", "content", "type"]
        }
    },
    {
        name: "read_agent_blackboard",
        description: "Read blackboard items visible to a mission agent.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" },
                agentId: { type: "string", description: "Reading agent ID" },
                topic: { type: "string", description: "Optional topic filter" },
                type: { type: "string", enum: ["goal", "observation", "hypothesis", "request", "result", "constraint", "affordance", "meta_trajectory"], description: "Optional type filter" },
                tags: { type: "array", items: { type: "string" }, description: "Optional required tags" },
                since: { type: "string", description: "Optional ISO timestamp lower bound" },
                includeExpired: { type: "boolean", description: "Whether to include expired items" },
                limit: { type: "number", description: "Maximum items to return" }
            },
            required: ["missionId", "agentId"]
        }
    },
    {
        name: "claim_agent_task",
        description: "Let an available agent claim the highest-priority pending task from an offline assignee.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" },
                agentId: { type: "string", description: "Claiming agent ID" },
                requiredSpecialty: { type: "string", description: "Optional required specialty" }
            },
            required: ["missionId", "agentId"]
        }
    },
    {
        name: "get_coordination_trajectories",
        description: "Get coordination trajectory events for offline meta-controller or HRL training.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" }
            },
            required: ["missionId"]
        }
    },
    {
        name: "record_affordance_observation",
        description: "Record an observed action opportunity and optional outcome for affordance-based planning.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" },
                observedBy: { type: "string", description: "Agent that observed the affordance" },
                state: {
                    type: "object",
                    properties: {
                        kind: { type: "string", enum: ["ui", "api", "file", "tool", "system"] },
                        signature: { type: "string" },
                        label: { type: "string" },
                        url: { type: "string" },
                        selector: { type: "string" },
                        method: { type: "string" },
                        path: { type: "string" },
                        metadata: { type: "object" }
                    },
                    required: ["kind", "signature"]
                },
                action: {
                    type: "object",
                    properties: {
                        kind: { type: "string", enum: ["click", "type", "submit", "navigate", "call", "read", "write", "execute"] },
                        description: { type: "string" },
                        parameters: { type: "object" }
                    },
                    required: ["kind", "description"]
                },
                outcome: {
                    type: "object",
                    properties: {
                        status: { type: "string", enum: ["success", "failure", "unknown"] },
                        description: { type: "string" },
                        stateDelta: { type: "object" },
                        rewardHint: { type: "number" }
                    },
                    required: ["status", "description"]
                },
                confidence: { type: "number", description: "Optional confidence from 0 to 1" },
                evidence: { type: "array", items: { type: "string" } },
                tags: { type: "array", items: { type: "string" } },
                publishToBlackboard: { type: "boolean", description: "Also publish this affordance to the shared agent blackboard" }
            },
            required: ["missionId", "observedBy", "state", "action", "outcome"]
        }
    },
    {
        name: "query_affordances",
        description: "Query learned affordances for a mission state or action context.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" },
                kind: { type: "string", enum: ["ui", "api", "file", "tool", "system"] },
                signature: { type: "string" },
                labelIncludes: { type: "string" },
                actionKind: { type: "string", enum: ["click", "type", "submit", "navigate", "call", "read", "write", "execute"] },
                minConfidence: { type: "number" },
                tags: { type: "array", items: { type: "string" } },
                limit: { type: "number" }
            },
            required: ["missionId"]
        }
    },
    {
        name: "suggest_affordance_actions",
        description: "Return ranked action suggestions from the affordance map.",
        inputSchema: {
            type: "object" as const,
            properties: {
                missionId: { type: "number", description: "Mission ID" },
                kind: { type: "string", enum: ["ui", "api", "file", "tool", "system"] },
                signature: { type: "string" },
                labelIncludes: { type: "string" },
                actionKind: { type: "string", enum: ["click", "type", "submit", "navigate", "call", "read", "write", "execute"] },
                minConfidence: { type: "number" },
                tags: { type: "array", items: { type: "string" } },
                limit: { type: "number" }
            },
            required: ["missionId"]
        }
    }
];

export const ListMissionsInput = z.object({
    orgId: z.number().optional(),
    limit: z.number().min(1).max(100).default(20),
});

export const GetMissionDetailsInput = z.object({
    missionId: z.number(),
});

export const GetMissionStatusInput = z.object({
    missionRunId: z.number(),
});

export const UpdateMissionInput = z.object({
    missionId: z.number(),
    name: z.string().optional(),
    objective: z.string().optional(),
    blackboard: z.record(z.any()).optional(),
});

export const CreateMissionInput = z.object({
    name: z.string(),
    objective: z.string(),
    executionStrategy: z.enum(["pre_planned", "dynamic_autonomous", "rolling_wave"]).optional(),
    orgId: z.number().optional(),
});

export const DeleteMissionInput = z.object({
    missionId: z.number(),
});

export const PlanMissionInput = z.object({
    prompt: z.string(),
    history: z.array(z.any()).optional(),
});

export const ListMissionTemplatesInput = z.object({
    orgId: z.number().optional(),
});

export const InstantiateMissionTemplateInput = z.object({
    templateId: z.number(),
    name: z.string(),
    customizations: z.record(z.any()).optional(),
});

export const ChatWithMissionInput = z.object({
    missionId: z.number(),
    message: z.string(),
});

export const GetMissionMemoriesInput = z.object({
    missionId: z.number(),
    limit: z.number().optional().default(20),
});

export const GetMissionTimelineInput = z.object({
    missionRunId: z.number(),
    limit: z.number().optional().default(50),
});

export const GetMissionActivityInput = z.object({
    missionId: z.number(),
});

export const PromoteShadowRunInput = z.object({
    shadowRunId: z.number(),
    name: z.string(),
    description: z.string().optional(),
});

export const GetMissionSuggestionsInput = z.object({
    missionId: z.number(),
});

export const UpdateMissionMembersInput = z.object({
    missionId: z.number(),
    addMembers: z.array(z.object({
        entityType: z.enum(["pipeline", "job"]),
        entityId: z.number(),
        role: z.string(),
    })).optional(),
    removeMemberIds: z.array(z.number()).optional(),
});

// Replay tools
export const GetMissionReplayHistoryInput = z.object({
    missionRunId: z.number(),
});

export const ReplayMissionFromCheckpointInput = z.object({
    missionRunId: z.number(),
    checkpointId: z.number(),
    modifyParameters: z.record(z.any()).optional(),
    dryRun: z.boolean().optional().default(false),
});

export const CompareMissionRunsInput = z.object({
    runIdA: z.number(),
    runIdB: z.number(),
});

export const GetMissionExecutionHeatmapInput = z.object({
    missionRunId: z.number(),
});

// Debug tools
export const StartMissionDebugSessionInput = z.object({
    missionRunId: z.number(),
    autoPauseOnStart: z.boolean().optional().default(false),
});

export const PauseMissionInput = z.object({
    missionRunId: z.number(),
});

export const ResumeMissionInput = z.object({
    missionRunId: z.number(),
});

export const StepMissionInput = z.object({
    missionRunId: z.number(),
    stepType: z.enum(["over", "into", "out"]).default("over"),
});

export const InspectMissionStateInput = z.object({
    missionRunId: z.number(),
});

export const ModifyMissionVariableInput = z.object({
    missionRunId: z.number(),
    path: z.string(), // dot-notation path like "blackboard.key"
    value: z.any(),
});

export const AddMissionBreakpointInput = z.object({
    missionRunId: z.number(),
    type: z.enum(["tool_call", "phase_change", "blackboard_update", "condition"]),
    target: z.string().optional(),
    condition: z.string().optional(),
    enabled: z.boolean().optional().default(true),
});

export const RemoveMissionBreakpointInput = z.object({
    missionRunId: z.number(),
    breakpointId: z.string(),
});

// Circuit Breaker tools
export const GetCircuitBreakerStatusInput = z.object({
    toolName: z.string().optional(),
});

export const ResetCircuitBreakerInput = z.object({
    toolName: z.string().optional(), // If not provided, resets all
});

export const ConfigureCircuitBreakerInput = z.object({
    toolName: z.string(),
    failureThreshold: z.number().min(1).optional(),
    recoveryTimeout: z.number().min(1000).optional(), // milliseconds
    halfOpenMaxCalls: z.number().min(1).optional(),
    successThreshold: z.number().min(1).optional(),
});

// Retry management tools
export const GetDeadLetterQueueInput = z.object({
    toolName: z.string().optional(),
    limit: z.number().min(1).max(100).default(20),
    since: z.string().optional(), // ISO date string
});

export const ReplayDeadLetterInput = z.object({
    entryId: z.string(),
});

export const RemoveDeadLetterInput = z.object({
    entryId: z.string(),
});

export const GetRetryStatsInput = z.object({}); // No parameters needed

// Mission Dependency tools
export const AddMissionDependencyInput = z.object({
    sourceMissionId: z.number(),
    targetMissionId: z.number(),
    type: z.enum(["sequential", "fan_out", "fan_in", "any_of", "all_of"]).default("sequential"),
    condition: z.enum(["completed", "succeeded", "failed", "any"]).default("completed"),
});

export const RemoveMissionDependencyInput = z.object({
    dependencyId: z.string(),
});

export const GetMissionDependenciesInput = z.object({
    missionId: z.number(),
});

export const GetDependencyGraphInput = z.object({
    missionIds: z.array(z.number()).optional(),
});

export const CheckDependenciesSatisfiedInput = z.object({
    missionId: z.number(),
});

export const GetExecutionOrderInput = z.object({
    missionIds: z.array(z.number()),
});

export const CreateMissionWorkflowInput = z.object({
    name: z.string(),
    definition: z.array(z.object({
        missionId: z.number(),
        dependsOn: z.array(z.number()).optional(),
        type: z.enum(["sequential", "fan_out", "fan_in", "any_of", "all_of"]).optional(),
        condition: z.enum(["completed", "succeeded", "failed", "any"]).optional(),
    })),
});

export const GetMissionWorkflowsInput = z.object({}); // No parameters

// Predictive Planning tools
export const GenerateMissionPlanInput = z.object({
    objective: z.string(),
    orgId: z.number().optional(),
    considerHistory: z.boolean().optional().default(true),
    maxSuggestions: z.number().min(1).max(10).optional().default(5),
});

export const GetMissionPatternsInput = z.object({});

export const GetToolRecommendationsInput = z.object({
    objective: z.string(),
});

export const EstimateMissionCompletionInput = z.object({
    objective: z.string(),
    pipeline: z.array(z.string()),
});

export const AssessMissionRiskInput = z.object({
    objective: z.string(),
    pipeline: z.array(z.string()).optional(),
});

export const FindSimilarMissionsInput = z.object({
    objective: z.string(),
    orgId: z.number().optional(),
    limit: z.number().min(1).max(20).optional().default(5),
});

// Self-Healing tools
export const GetSelfHealingStatsInput = z.object({});

export const GetFailurePatternsInput = z.object({});

export const GetActiveEscalationsInput = z.object({
    status: z.enum(["pending", "acknowledged", "resolved"]).optional(),
});

export const AcknowledgeEscalationInput = z.object({
    escalationId: z.string(),
    response: z.string().optional(),
});

export const ResolveEscalationInput = z.object({
    escalationId: z.string(),
    resolution: z.string(),
    learnPattern: z.boolean().optional().default(false),
});

// Multi-Agent Coordination tools
export const CreateAgentInput = z.object({
    missionId: z.number(),
    name: z.string(),
    role: z.enum(["planner", "executor", "reviewer", "specialist", "coordinator"]),
    specialties: z.array(z.string()).optional(),
});

export const GetAgentsInput = z.object({
    missionId: z.number(),
});

export const SendAgentMessageInput = z.object({
    fromAgentId: z.string(),
    toAgentId: z.string().optional(),
    type: z.enum(["task_assignment", "task_claim", "review_request", "review_feedback", "consensus_proposal", "consensus_vote", "conflict_notification", "information_share", "decision_request", "status_update", "blackboard_post"]),
    content: z.string(),
    priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    requiresResponse: z.boolean().optional(),
});

export const CreateConsensusProposalInput = z.object({
    missionId: z.number(),
    proposedBy: z.string(),
    topic: z.string(),
    proposal: z.string(),
    options: z.array(z.string()),
    deadline: z.string().optional(),
    conclusionThreshold: z.number().min(0.5).max(1).optional().default(0.7),
});

export const CastConsensusVoteInput = z.object({
    consensusId: z.string(),
    agentId: z.string(),
    option: z.string(),
});

export const AssignAgentTaskInput = z.object({
    missionId: z.number(),
    assignedBy: z.string(),
    assignedTo: z.string(),
    description: z.string(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
    deadline: z.string().optional(),
    reviewBy: z.string().optional(),
});

export const UpdateAgentTaskStatusInput = z.object({
    taskId: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "failed", "blocked"]),
    result: z.any().optional(),
});

export const DetectConflictInput = z.object({
    missionId: z.number(),
    agents: z.array(z.string()),
    type: z.enum(["task_dispute", "resource_contention", "approach_disagreement", "priority_conflict", "deadlock"]),
    description: z.string(),
    severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});

export const GetMissionCoordinationStatsInput = z.object({
    missionId: z.number(),
});

export const CreateCoordinatorPoolInput = z.object({
    missionId: z.number(),
    goal: z.string(),
    requiredRoles: z.array(z.enum(["planner", "executor", "reviewer", "specialist", "coordinator"])),
    seedTasks: z.array(z.object({
        description: z.string(),
        role: z.enum(["planner", "executor", "reviewer", "specialist", "coordinator"]).optional(),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        dependencies: z.array(z.string()).optional(),
        deliverables: z.array(z.string()).optional(),
    })).optional(),
    postGoalToBlackboard: z.boolean().optional(),
});

export const PostAgentBlackboardItemInput = z.object({
    missionId: z.number(),
    postedBy: z.string(),
    topic: z.string(),
    content: z.string(),
    type: z.enum(["goal", "observation", "hypothesis", "request", "result", "constraint", "affordance", "meta_trajectory"]),
    priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    visibility: z.enum(["mission", "role", "agent"]).default("mission"),
    targetRole: z.enum(["planner", "executor", "reviewer", "specialist", "coordinator"]).optional(),
    targetAgentId: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
    context: z.record(z.any()).optional(),
    expiresAt: z.string().optional(),
});

export const ReadAgentBlackboardInput = z.object({
    missionId: z.number(),
    agentId: z.string(),
    topic: z.string().optional(),
    type: z.enum(["goal", "observation", "hypothesis", "request", "result", "constraint", "affordance", "meta_trajectory"]).optional(),
    tags: z.array(z.string()).optional(),
    since: z.string().optional(),
    includeExpired: z.boolean().optional(),
    limit: z.number().min(1).max(100).optional(),
});

export const ClaimAgentTaskInput = z.object({
    missionId: z.number(),
    agentId: z.string(),
    requiredSpecialty: z.string().optional(),
});

export const GetCoordinationTrajectoriesInput = z.object({
    missionId: z.number(),
});

export const AffordanceStateInput = z.object({
    kind: z.enum(["ui", "api", "file", "tool", "system"]),
    signature: z.string(),
    label: z.string().optional(),
    url: z.string().optional(),
    selector: z.string().optional(),
    method: z.string().optional(),
    path: z.string().optional(),
    metadata: z.record(z.any()).optional(),
});

export const AffordanceActionInput = z.object({
    kind: z.enum(["click", "type", "submit", "navigate", "call", "read", "write", "execute"]),
    description: z.string(),
    parameters: z.record(z.any()).optional(),
});

export const AffordanceOutcomeInput = z.object({
    status: z.enum(["success", "failure", "unknown"]),
    description: z.string(),
    stateDelta: z.record(z.any()).optional(),
    rewardHint: z.number().optional(),
});

export const RecordAffordanceObservationInput = z.object({
    missionId: z.number(),
    observedBy: z.string(),
    state: AffordanceStateInput,
    action: AffordanceActionInput,
    outcome: AffordanceOutcomeInput,
    confidence: z.number().min(0).max(1).optional(),
    evidence: z.array(z.string()).optional().default([]),
    tags: z.array(z.string()).optional().default([]),
    publishToBlackboard: z.boolean().optional().default(false),
});

export const QueryAffordancesInput = z.object({
    missionId: z.number(),
    kind: z.enum(["ui", "api", "file", "tool", "system"]).optional(),
    signature: z.string().optional(),
    labelIncludes: z.string().optional(),
    actionKind: z.enum(["click", "type", "submit", "navigate", "call", "read", "write", "execute"]).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().min(1).max(100).optional(),
});

export const SuggestAffordanceActionsInput = QueryAffordancesInput;

