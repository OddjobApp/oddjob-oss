# Workgroup & Mission Tools

Tools for managing collaborative agent workgroups and missions. These tools allow agents to share memory, coordinate plans, and execute complex workflows.

## Collaboration Tools

### 1. Update Blackboard (`update_blackboard`)
Updates the shared JSON state of the workgroup.
- **Parameters**: 
  - `content`: JSON content to merge.
  - `reason`: Explanation for the update.
- **Usage**: "I have completed the extraction phase. Updating blackboard status to 'analysis'."
- **Effect**: Merges the provided JSON into the workgroup's `blackboard` column using deep merge logic.

### 2. Get Blackboard (`get_blackboard`)
Reads the current shared state.
- **Parameters**: None.
- **Usage**: "I need to check the current strategic plan before proceeding."
- **Returns**: Full JSON object of the blackboard.

### 3. Add Shared Memory (`add_shared_memory`)
Logs a specific observation or finding for other agents.
- **Parameters**:
  - `observation`: Text description of finding.
  - `source`: Your identifier (e.g., job name).
- **Usage**: "Competitor X pricing updated to $10.99."
- **Effect**: Appends to `blackboard.sharedMemories` array (FIFO limited to 50 items).

## Mission Tools

### 4. Report Mission Progress (`report_mission_status`)
(Reserved for future implementation) - Currently handled implicitly by pipeline status.

### 5. Launch Sub-Mission (`launch_mission`)
Triggers the execution of the Workgroup's Mission.
- **Parameters**:
  - `reason`: Why you are launching this mission.
- **Usage**: "Conditions met. Launching mission to optimize prices."
- **Effect**: Starts the Supervisor pipeline which plans and delegates tasks.
