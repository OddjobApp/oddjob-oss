# Scribe Studio ↔ Media Studio Integration Best Practices

## Overview

This document provides comprehensive best practices for agents integrating Scribe Studio manuscript management with Media Studio video production. It covers character and location synchronization, script-to-storyboard conversion, dialogue management, and maintaining narrative consistency across both studios.

## Core Integration Principles

### 1. **Single Source of Truth**
- **Scribe is Primary**: Scribe manuscript is the authoritative source for story elements
- **Media Studio Extends**: Media Studio extends Scribe with visual production elements
- **Bidirectional Sync**: Changes in Scribe should reflect in Media Studio, and vice versa
- **No Divergence**: Prevent story elements from diverging between studios

### 2. **Entity Synchronization**
- **Character Consistency**: Characters must match between manuscript and production
- **Location Consistency**: Locations must match between script and visual production
- **Dialogue Accuracy**: Dialogue in video must match script dialogue
- **Scene Structure**: Scene organization should be consistent across studios

### 3. **Workflow Integration**
- **Sequential Flow**: Script → Storyboard → Shots → Takes → Assembly
- **Gate-Based Progression**: Each stage requires completion before the next
- **Back-Reference**: Video production can inform script refinements
- **Approval Gates**: User approval required at key decision points

## Character Management Integration

### 1. **Character Definition Synchronization**

#### **Character Entity Structure**
```markdown
Character Entity Fields (Scribe Studio):
- name: "Character Name"
- entityType: "character"
- definitionText: "Physical description, personality, role"
- aliases: ["Nickname", "Alternative names"]
- firstDefinedNodeId: Scene where character first appears

Character View Fields (Media Studio):
- id: Entity ledger ID
- kind: "character"
- name: Character name
- description: Character description
- aliases: Array of aliases
- inUseInVideo: Whether used in approved video takes
```

#### **Character Sync Workflow**
```typescript
// Character Synchronization Pattern
async function syncCharactersFromScribe(productionId: number) {
  // 1. Get Scribe document linked to production
  const scribeDocument = await getScribeDocument(productionId);
  
  // 2. Fetch character entities from Scribe
  const scribeCharacters = await getScribeEntityLedger(scribeDocument.id, "character");
  
  // 3. Transform to Media Studio character view
  const mediaCharacters = scribeCharacters.map(char => ({
    id: char.id,
    kind: "character",
    name: char.termName,
    description: char.definitionText,
    aliases: char.aliases || [],
    inUseInVideo: await checkCharacterVideoUsage(productionId, char.termName)
  }));
  
  // 4. Update production character list
  await updateProductionCharacters(productionId, mediaCharacters);
  
  // 5. Generate reference images for new characters
  for (const character of mediaCharacters) {
    if (!hasReference(character.id)) {
      await requestCharacterReference(productionId, character);
    }
  }
}
```

### 2. **Character Continuity Management**

#### **Character Reference Generation**
```markdown
Character Reference Prompt Pattern:
A character reference sheet for [Character Name][, optional description]
A full-length front view and a head-and-close-up side by side, 
on a plain neutral background in even light, so the face, hair and 
wardrobe are clear. No text, labels or borders.

Character Description Guidelines:
- Physical Appearance: Height, build, hair color/style, eye color
- Costume Details: Clothing style, colors, accessories
- Distinguishing Features: Scars, tattoos, distinctive traits
- Age Range: Approximate age for visual reference
- Expression: Neutral expression for base reference
```

#### **Character Continuity Workflow**
```typescript
// Character Continuity Tracking Pattern
async function trackCharacterContinuity(productionId: number) {
  // 1. Get all approved takes with character anchors
  const takesWithCharacters = await getApprovedTakesWithAnchors(productionId);
  
  // 2. Extract character usage across takes
  const characterUsage = new Map<string, Set<number>>();
  for (const take of takesWithCharacters) {
    for (const anchor of take.request.characterAnchors || []) {
      if (!characterUsage.has(anchor.name)) {
        characterUsage.set(anchor.name, new Set());
      }
      characterUsage.get(anchor.name)!.add(take.id);
    }
  }
  
  // 3. Update character in-use status
  for (const [characterName, takeIds] of characterUsage) {
    await updateCharacterUsageStatus(productionId, characterName, true);
  }
  
  // 4. Mark unused characters as safe for removal
  const allCharacters = await getProductionCharacters(productionId);
  for (const character of allCharacters) {
    if (!characterUsage.has(character.name)) {
      await updateCharacterUsageStatus(agentId, character.name, false);
    }
  }
}
```

### 3. **Character Reference Approval**

#### **Reference Quality Standards**
```markdown
Character Reference Quality Checklist:
□ Full-body view shows entire character clearly
□ Close-up shows face details (eyes, expression, skin tone)
□ Lighting is even and flattering (no harsh shadows)
□ Background is neutral and non-distracting
□ Costume is visible and accurate
□ Character is in neutral expression
□ No text, labels, or watermarks
□ Resolution meets production standards
□ Consistent with character description
```

#### **Reference Approval Process**
```typescript
// Reference Approval Decision Pattern
function shouldApproveReference(reference: ReferenceView): ApprovalDecision {
  const issues = [];
  
  // Quality checks
  if (!reference.imageUrl) {
    issues.push("Reference has no image yet");
  }
  if (reference.status !== "ready") {
    issues.push(`Reference is ${reference.status}, not ready for approval`);
  }
  
  // Visual quality checks
  if (reference.imageUrl) {
    const quality = await assessReferenceQuality(reference.imageUrl);
    if (!quality.passes) {
      issues.push(...quality.issues);
    }
  }
  
  // Consistency checks
  const character = getCharacterByName(reference.name);
  if (character && !matchesDescription(reference, character)) {
    issues.push("Reference doesn't match character description");
  }
  
  return {
    approved: issues.length === 0,
    issues,
    recommendation: issues.length > 0 ? `Render another reference: ${issues.join(", ")}` : "Approve"
  };
}
```

## Location Management Integration

### 1. **Location Synchronization**

#### **Location Entity Structure**
```markdown
Location Entity Fields (Scribe Studio):
- name: "Location Name"
- entityType: "location"
- definitionText: "Physical description, atmosphere, time-of-day considerations"
- aliases: ["Alternative names", "References"]

Location Usage (Media Studio):
- id: Entity ledger ID
- kind: "location"
- name: Location name
- description: Location description
- aliases: Array of aliases
- sceneUsage: Which scenes use this location
```

#### **Location Sync Workflow**
```typescript
// Location Synchronization Pattern
async function syncLocationsFromScribe(productionId: number) {
  // 1. Get Scribe document
  const scribeDocument = await getScribeDocument(productionId);
  
  // 2. Fetch location entities
  const scribeLocations = await getScribeEntityLedger(scribeDocument.id, "location");
  
  // 3. Transform to Media Studio location view
  const mediaLocations = scribeLocations.map(loc => ({
    id: loc.id,
    kind: "location",
    name: loc.termName,
    description: loc.definitionText,
    aliases: loc.aliases || []
  }));
  
  // 4. Update production
  await updateProductionLocations(productionId, mediaLocations);
  
  // 5. Identify locations used in scenes but not in manuscript
  const sceneLocations = await getLocationsFromScenes(productionId);
  const orphanLocations = sceneLocations.filter(loc => 
    !mediaLocations.some(ml => namesMatch(ml.name, loc.name))
  );
  
  // 6. Add orphan locations to production
  if (orphanLocations.length > 0) {
    await addImplicitLocations(productionId, orphanLocations);
  }
}
```

### 2. **Location Reference Generation**

#### **Location Reference Prompt Pattern**
```markdown
Location Reference Prompt Pattern:
A location reference for [Location Name][, optional description]
A wide establishing view with no people in it, showing the layout, 
materials and light of the place. [Additional context about time of day, 
atmosphere, etc.]
No text, labels or borders.

Location Description Guidelines:
- Physical Layout: Architecture, furniture, spatial arrangement
- Materials: Building materials, textures, surfaces
- Lighting: Natural or artificial light sources
- Atmosphere: Mood, feeling, emotional quality
- Time-of-Day: Dawn, midday, golden hour, dusk, night
- Context: How location relates to story/characters
```

#### **Location Reference Approval**
```typescript
// Location Reference Approval Pattern
function shouldApproveLocationReference(reference: ReferenceView): ApprovalDecision {
  const issues = [];
  
  // Check that reference matches location description
  const location = getLocationByName(reference.name);
  if (location && !matchesDescription(reference, location)) {
    issues.push("Reference doesn't match location description");
  }
  
  // Check for unwanted elements
  if (reference.imageUrl) {
    const elements = await detectElementsInImage(reference.imageUrl);
    if (elements.people > 0) {
      issues.push("Location reference should not contain people");
    }
    if (elements.text > 0) {
      issues.push("Location reference should not contain text");
    }
  }
  
  return {
    approved: issues.length === 0,
    issues,
    recommendation: issues.length > 0 ? "Render a new reference without people or text" : "Approve"
  };
}
```

## Script-to-Storyboard Conversion

### 1. **Scene Structure Mapping**

#### **Scribe Station to Scene Mapping**
```markdown
Station-to-Scene Conversion Rules:
1. Each Scribe station → One Media Studio scene
2. Station title → Scene title
3. Station content → Scene synopsis
4. Scene slugline → Scene location (extracted)
5. Time indicators → Scene time of day
6. Mood indicators → Scene mood
7. Dialogues within station → Shot dialogue
8. [SHOT N] blocks → Shot definitions
```

#### **Scene Creation Workflow**
```typescript
// Scene Creation from Scribe Pattern
async function createScenesFromScribe(productionId: number) {
  // 1. Get Scribe document
  const scribeDocument = await getScribeDocument(productionId);
  
  // 2. Get Scribe stations
  const stations = await getScribeStations(scribeDocument.id);
  
  // 3. Convert each station to a scene
  const scenes = stations.map((station, index) => {
    const sceneKey = `SCENE-${String(index + 1).padStart(2, '0')}`;
    
    // Extract scene metadata from station content
    const metadata = parseStationMetadata(station.content);
    
    return {
      sceneKey,
      title: station.title,
      synopsis: station.content,
      location: metadata.location || "",
      timeOfDay: metadata.timeOfDay || "",
      mood: metadata.mood || "",
      scribeNodeId: station.id
    };
  });
  
  // 4. Create scenes in Media Studio
  for (const scene of scenes) {
    await createScene(productionId, scene);
  }
  
  // 5. Link scenes to their originating stations
  for (const scene of scenes) {
    await linkSceneToStation(scene.id, scene.scribeNodeId);
  }
}
```

### 2. **Plot Point Generation**

#### **Station to Plot Point Conversion**
```markdown
Station Breakdown Strategy:
1. Analyze station content for natural breaks
2. Identify story beats and turning points
3. Create plot points at logical intervals
4. Assign meaningful titles to plot points
5. Include beat notes for context
6. Maintain narrative flow across plot points

Plot Point Naming Convention:
- Descriptive and meaningful
- Story-focused (not technical)
- Consistent naming pattern
- Reference key story elements
```

#### **Plot Point Creation Pattern**
```typescript
// Plot Point Generation Pattern
async function generatePlotPointsFromScene(sceneId: number) {
  const scene = await getScene(sceneId);
  const station = await getLinkedStation(scene.scribeNodeId);
  
  // Analyze station content for beats
  const beats = analyzeStationContent(station.content);
  
  // Create plot points for each beat
  for (const beat of beats) {
    await createPlotPoint(sceneId, {
      title: beat.title,
      beat: beat.description
    });
  }
}
```

### 3. **Dialogue Extraction and Formatting**

#### **Dialogue Extraction from Scribe**
```markdown
Dialogue Extraction Rules:
1. Identify character names in quotes
2. Extract dialogue between quotes
3. Identify speaker (character name)
4. Parse delivery instructions (whispering, shouting, etc.)
5. Format for Media Studio dialogue structure
6. Associate dialogue with appropriate shots

Dialogue Format Examples:
Scribe: `Elena: "I found the cylinder."`
Media Studio: { speaker: "Elena", line: "I found the cylinder." }

Scribe: `Director (shouting): "Cut!"`
Media Studio: { speaker: "Director", line: "Cut!", delivery: "shouting" }
```

#### **Dialogue Management Workflow**
```typescript
// Dialogue Management Pattern
async function processDialogueForShot(shotId: number, sceneId: number) {
  const station = await getLinkedStation(sceneId);
  const stationContent = station.content;
  
  // Extract dialogue from station
  const dialogueLines = extractDialogue(stationContent);
  
  // Transform to Media Studio format
  const formattedDialogue = dialogueLines.map(line => ({
    speaker: line.speaker,
    line: line.dialogue,
    delivery: line.delivery || ""
  }));
  
  // Assign dialogue to shot
  await updateShotDialogue(shotId, formattedDialogue);
  
  // Validate dialogue against character list
  const characters = await getProductionCharacters(scene.productionId);
  const unknownSpeakers = formattedDialogue
    .filter(line => !isKnownCharacter(line.speaker, characters));
  
  if (unknownSpeakers.length > 0) {
    const warning = `Unknown speakers in dialogue: ${unknownSpeakers.map(s => s.speaker).join(", ")}`;
    await addDialogueWarning(shotId, warning);
  }
}
```

## Scene and Story Organization

### 1. **Scene Structure Best Practices**

#### **Scene Organization Guidelines**
```markdown
Scene Organization Principles:
1. **Single Focus**: Each scene should have one primary focus
2. **Logical Flow**: Scenes should flow naturally in story order
3. **Appropriate Length**: Scene length should match story importance
4. **Clear Beginnings**: Scenes should have clear entry points
5. **Clear Endings**: Scenes should resolve to a logical stopping point
```

#### **Scene Pacing Patterns**
```markdown
Scene Pacing Guidelines:
- Action Scenes: Fast-paced, quick cuts, dynamic
- Dialogue Scenes: Slower-paced, focus on conversation
- Emotional Scenes: Patient pacing, allow emotional resonance
- Transition Scenes: Measured pacing, bridge story elements
- Climax Scenes: Intense pacing, build to climax
- Resolution Scenes: Slower pacing, provide closure
```

### 2. **Scene Metadata Management**

#### **Metadata Extraction from Scribe**
```typescript
// Scene Metadata Extraction Pattern
function extractSceneMetadata(stationContent: string): SceneMetadata {
  const metadata: SceneMetadata = {
    location: "",
    timeOfDay: "",
    mood: "",
    characters: [],
    actions: []
  };
  
  // Extract slugline for location
  const sluglineMatch = /^(INT\.|EXT\.|INT\/EXT\.)\s+([^-]+)\s*-\s*(.+)$/i.exec(stationContent);
  if (sluglineMatch) {
    metadata.location = sluglineMatch[2].trim();
    // Extract time from second part
    const timeMatch = /(morning|afternoon|evening|night|dawn|dusk|day|night)/i.exec(sluglineMatch[3]);
    if (timeMatch) {
      metadata.timeOfDay = timeMatch[1].toLowerCase();
    }
  }
  
  // Extract mood indicators
  const moodIndicators = ["tense", "romantic", "mysterious", "suspenseful", "melancholic", "joyful", "ominous"];
  for (const indicator of moodIndicators) {
    if (stationContent.toLowerCase().includes(indicator)) {
      metadata.mood = indicator;
      break;
    }
  }
  
  return metadata;
}
```

#### **Scene Metadata Consistency**
```typescript
// Scene Metadata Validation Pattern
function validateSceneMetadata(scene: SceneView, station: StationView): ValidationResult {
  const issues = [];
  
  // Check if scene location matches station location
  if (station.location && scene.location && 
      !namesMatch(scene.location, station.location)) {
    issues.push(`Scene location "${scene.location}" doesn't match station location "${station.location}"`);
  }
  
  // Check if time-of-day is consistent
  if (station.timeOfDay && scene.timeOfDay && 
      scene.timeOfDay !== station.timeOfDay) {
    issues.push(`Scene time-of-day "${scene.timeOfDay}" doesn't match station "${station.timeOfDay}"`);
  }
  
  // Check if mood is consistent
  if (station.mood && scene.mood && 
      scene.mood !== station.mood) {
    issues.push(`Scene mood "${scene.mory}" doesn't match station mood "${station.mood}"`);
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}
```

## Dialogue Management Integration

### 1. **Dialogue Format Conversion**

#### **Scribe to Media Studio Dialogue Format**
```markdown
Scribe Studio Dialogue Format:
Character Name: "Dialogue text" (delivery instruction)

Media Studio Dialogue Format:
{
  speaker: "Character Name",
  line: "Dialogue text",
  delivery: "delivery instruction"
}

Conversion Examples:
Scribe: `Elena: "I can't believe it's real." (whispering)`
Media Studio: { speaker: "Character Name", line: "I can't believe it's real.", delivery: "whispering" }

Scribe: `Director: "Cut! Print!" (shouting)`
Media Studio: { speaker: "Director", line: "Cut! Print!", delivery: "shouting" }
```

#### **Dialogue Conversion Pattern**
```typescript
// Dialogue Conversion Pattern
function convertScribeDialogue(scribeDialogue: string): DialogueLine[] {
  const lines: DialogueLine[] = [];
  
  // Match dialogue pattern: Name: "Text" (delivery)
  const dialogueRegex = /(\w+(?:\s+\([^)]+\))?):\s*"([^"]+)"(?:\s*\(([^)]+)\))?/g;
  
  let match;
  while ((match = dialogueRegex.exec(scribeDialogue)) !== null) {
    const speaker = match[1].split(/\s+/)[0]; // Remove delivery from speaker name
    const text = match[2];
    const delivery = match[3] || "";
    
    lines.push({
      speaker: speaker,
      line: text,
      delivery: delivery.replace(/[()]/g, "").trim()
    });
  }
  
  return lines;
}
```

### 2. **Dialogue Validation**

#### **Dialogue Quality Checks**
```markdown
Dialogue Validation Checklist:
□ All speakers are defined as characters in manuscript
□ Dialogue is appropriate for scene tone
□ Dialogue length fits shot duration (2.5 words/second max)
□ Delivery instructions are clear and actionable
□ Dialogue advances story or reveals character
□ Dialogue doesn't contain exposition dumps
□ Dialogue sounds natural when spoken
```

#### **Dialogue Validation Pattern**
```typescript
// Dialogue Validation Pattern
function validateDialogue(dialogue: DialogueLine[], characters: CharacterView[], durationSeconds: number): ValidationResult {
  const issues = [];
  
  for (const line of dialogue) {
    // Check if speaker is a known character
    const isKnown = characters.some(char => 
      namesMatch(char.name, line.speaker)
    );
    if (!isKnown) {
      issues.push(`Unknown speaker "${line.speaker}" in dialogue`);
    }
    
    // Check dialogue length
    const wordCount = line.line.split(/\s+/).length;
    const maxWords = Math.floor(durationSeconds * 2.5);
    if (wordCount > maxWords) {
      issues.push(`Dialogue "${line.line}" (${wordCount} words) won't fit in ${durationSeconds} seconds`);
    }
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}
```

### 3. **Dialogue Assignment to Shots**

#### **Dialogue Assignment Strategy**
```markdown
Dialogue Assignment Guidelines:
1. **Proximity**: Assign dialogue to shots where dialogue naturally occurs
2. **Character Presence**: Ensure character is visible when speaking
3. **Scene Context**: Assign dialogue in scene-appropriate context
4. **Timing Considerations**: Consider shot duration for dialogue amount
5. **Flow Considerations**: Ensure dialogue flows naturally between shots
```

#### **Dialogue Assignment Pattern**
```typescript
// Dialogue Assignment Pattern
async function assignDialogueToShots(sceneId: number) {
  const shots = await getShots(sceneId);
  const station = await getLinkedStation(getScene(sceneId).scribeNodeId);
  
  // Extract all dialogue from station
  const allDialogue = extractDialogue(station.content);
  
  // Assign dialogue to shots based on content analysis
  for (const shot of shots) {
    const relevantDialogue = findRelevantDialogue(shot.action, allDialogue);
    if (relevantDialogue.length > 0) {
      await updateShotDialogue(shot.id, relevantDialogue);
    }
  }
}

function findRelevantDialogue(shotAction: string, allDialogue: DialogueLine[]): DialogueLine[] {
  const actionLower = shotAction.toLowerCase();
  const characterNames = allDialogue.map(d => d.speaker.toLowerCase());
  
  return allDialogue.filter(line => {
    const lineLower = line.line.toLowerCase();
    // Include dialogue if:
    // 1. Dialogue mentions something in the action
    // 2. Dialogue is from a character in the action
    const mentionsAction = characterNames.some(name => actionLower.includes(name));
    const mentionsActionConcept = keyConceptsOverlap(actionLower, lineLower);
    
    return mentionsAction || mentionsActionConcept;
  });
}
```

## Cross-Studio State Management

### 1. **Bidirectional Synchronization**

#### **Scribe → Media Studio Sync**
```typescript
// Scribe to Media Studio Sync Pattern
async function syncScribeToMediaStudio(productionId: number) {
  // 1. Check if production is linked to Scribe document
  const production = await getProduction(productionId);
  if (!production.scribeDocumentId) {
    return; // No sync needed
  }
  
  // 2. Get latest Scribe entities
  const scribeData = await getScribeData(production.scribeDocumentId);
  
  // 3. Sync characters
  await syncCharactersFromScribe(productionId);
  
  // 4. Sync locations
  await syncLocationsFromScribe(productionId);
  
  // 5. Check for orphaned elements in Media Studio
  await identifyOrphanedElements(productionId);
  
  // 6. Update production view
  await refreshProductionView(productionId);
}
```

#### **Media Studio → Scribe Feedback**
```typescript
// Media Studio to Scribe Feedback Pattern
async function suggestScribeRefinements(productionId: number) {
  const production = await getProduction(productionId);
  
  const suggestions = [];
  
  // Check for characters in video but not in manuscript
  const orphanCharacters = await findCharactersInVideoNotInManuscript(productionId);
  if (orphanCharacters.length > 0) {
    suggestions.push({
      type: "character",
      message: `Characters used in video but not in manuscript: ${orphanCharacters.join(", ")}`,
      recommendation: "Add these characters to the Scribe manuscript"
    });
  }
  
  // Check for locations in video but not in manuscript
  const orphanLocations = await findLocationsInVideoNotInManuscript(productionId);
  if (orphanLocations.length > 0) {
    suggestions.push({
      type: "location",
      message: `Locations used in video but not in manuscript: ${orphanLocations.join(", ")}`,
      recommendation: "Add these locations to the Scribe manuscript"
    });
  }
  
  // Check for story inconsistencies
  const storyIssues = await analyzeStoryConsistency(productionId);
  if (storyIssues.length > 0) {
    suggestions.push({
      type: "story",
      message: `Story inconsistencies detected: ${storyIssues.join("; ")}`,
      recommendation: "Review story structure in Scribe Studio"
    });
  }
  
  return suggestions;
}
```

### 2. **Conflict Resolution**

#### **Entity Naming Conflicts**
```markdown
Naming Conflict Resolution:
1. Scribe name takes precedence (authoritative source)
2. Media Studio variations should align with Scribe naming
3. Aliases can accommodate minor naming differences
4. Case-insensitive matching for flexibility
5. User notification for significant naming changes
```

#### **Conflict Resolution Pattern**
```typescript
// Conflict Resolution Pattern
function resolveEntityConflict(scribeEntity: ScribeEntity, mediaEntity: MediaEntity): Resolution {
  // Scribe is authoritative
  if (namesMatch(scribeEntity.name, mediaEntity.name)) {
    return {
      action: "keep_scribe",
      message: "Entities match, keeping Scribe definition"
    };
  }
  
  // Check if it's just a case or alias difference
  if (namesMatch(scribeEntity.name, mediaEntity.name, true)) {
    return {
      action: "align_media",
      message: "Same name with different case, aligning Media Studio to Scribe"
    };
  }
  
  // If Media Studio has character reference but Scribe doesn't
  if (scribeEntity.definitionText && !mediaEntity.description) {
    return {
      action: "update_media",
      message: "Add description from Scribe to Media Studio"
    };
  }
  
  // If Scribe has description but Media Studio doesn't
  if (mediaEntity.description && !scribeEntity.definitionText) {
    return {
      action: "update_scribe",
      message: "Add description from Media Studio to Scribe"
    };
  }
  
  return {
    action: "notify_user",
    message: "Naming conflict detected, user decision required"
  };
}
```

### 3. **Change Propagation**

#### **Scribe Change Propagation**
```typescript
// Scribe Change Propagation Pattern
async function propagateScribeChange(scribeDocumentId: number, changeType: string) {
  // Find all productions linked to this Scribe document
  const productions = await getProductionsByScribeDocument(scribeDocumentId);
  
  for (const production of productions) {
    switch (changeType) {
      case "character_added":
        await syncCharactersFromScribe(production.id);
        break;
      case "character_removed":
        await removeCharacterFromMediaStudio(production.id, changeDetails.characterId);
        break;
      case "character_updated":
        await updateCharacterInMediaStudio(production.id, changeDetails);
        break;
      case "location_added":
        await syncLocationsFromScribe(production.id);
        break;
      case "location_updated":
        await updateLocationInMediaStudio(production.id, changeDetails);
        break;
      case "scene_structure_changed":
        await regenerateScenesFromScribe(production.id);
        break;
    }
  }
}
```

## Quality Assurance

### 1. **Consistency Validation**

#### **Cross-Studio Consistency Checks**
```markdown
Consistency Validation Checklist:
□ Characters match between Scribe and Media Studio
□ Locations match between script and video
□ Scene structure is consistent between studios
□ Dialogue text matches script exactly
□ Character descriptions match reference images
□ Location descriptions match reference images
□ Scene mood matches lighting in video
□ Time-of-day is consistent across scene
```

#### **Consistency Validation Pattern**
```typescript
// Consistency Validation Pattern
async function validateCrossStudioConsistency(productionId: number): ConsistencyReport {
  const report: ConsistencyReport = {
    issues: [],
    warnings: [],
    recommendations: []
  };
  
  // Get data from both studios
  const scribeData = await getScribeData(production.scribeDocumentId);
  const mediaData = await getProduction(productionId);
  
  // Check character consistency
  const characterIssues = validateCharacterConsistency(scribeData.characters, mediaData.characters);
  report.issues.push(...characterIssues);
  
  // Check location consistency
  const locationIssues = validateLocationConsistency(scribeData.locations, mediaData.locations);
  report.issues.push(...locationIssues);
  
  // Check scene structure consistency
  const sceneIssues = validateSceneStructureConsistency(scribeData.stations, mediaData.scenes);
  report.issues.push(...sceneIssues);
  
  // Check dialogue consistency
  const dialogueIssues = validateDialogueConsistency(scribeData.content, mediaData.shots);
  report.issues.push(...dialogueIssues);
  
  return report;
}
```

### 2. **Data Integrity**

#### **Entity Relationship Validation**
```typescript
// Entity Relationship Validation Pattern
async function validateEntityRelationships(productionId: number): IntegrityReport {
  const report: IntegrityReport = {
    issues: [],
    warnings: [],
    orphans: []
  };
  
  // Check for characters used in video but not in manuscript
  const videoCharacters = await getCharactersInVideo(productionId);
  const manuscriptCharacters = await getManuscriptCharacters(productionId);
  const orphanCharacters = videoCharacters.filter(vc => 
    !manuscriptCharacters.some(mc => namesMatch(vc.name, mc.name))
  );
  
  if (orphanCharacters.length > 0) {
    report.orphans.push(...orphanCharacters.map(c => ({
      type: "character",
      name: c.name,
      recommendation: "Add to Scribe manuscript or remove from video"
    })));
  }
  
  // Check for locations used in video but not in manuscript
  const videoLocations = await getLocationsInVideo(productionId);
  const manuscriptLocations = await getManuscriptLocations(productionId);
  const orphanLocations = videoLocations.filter(vl => 
    !manuscriptLocations.some(ml => namesMatch(vl.name, ml.name))
  );
  
  if (orphanLocations.length > 0) {
    report.orphans.push(...orphanLocations.map(l => ({
      type: "location",
      name: l.name,
      recommendation: "Add to Scribe manuscript or remove from video"
    })));
  }
  
  return report;
}
```

## Workflow Orchestration

### 1. **Initial Setup Workflow**

#### **Production Initialization**
```markdown
Production Setup Workflow:
1. User requests video production in CREW room
2. Agent checks for existing Scribe manuscript
3. If manuscript exists, link to Media Studio production
4. If no manuscript, prompt user to create one in Scribe Studio
5. Import scenes from manuscript structure
6. Generate character and location references
7. Approve references and keyframes
8. Begin shot creation process
```

#### **Initial Setup Pattern**
```typescript
// Production Setup Pattern
async function initializeProductionFromScribe(crewSessionId: number, manuscriptTitle: string) {
  // 1. Find or create Scribe manuscript
  const manuscript = await findOrCreateManuscript(crewSessionId, manuscriptTitle);
  
  // 2. Create Media Studio production
  const production = await createProduction({
    title: manuscriptTitle,
    scribeDocumentId: manuscript.id,
    crewSessionId
  });
  
  // 3. Import scenes from manuscript
  await importScenesFromScribe(production.id);
  
  // 4. Generate character references
  const characters = await getManuscriptCharacters(manuscript.id);
  for (const character of characters) {
    await requestCharacterReference(production.id, character);
  }
  
  // 5. Generate location references
  const locations = await getManuscriptLocations(manuscript.id);
  for (const location of locations) {
    await requestLocationReference(production.id, location);
  }
  
  // 6. Open Media Studio for user
  return openMediaStudio(production.id);
}
```

### 2. **Iterative Refinement Workflow**

#### **Story → Visual Refinement Cycle**
```markdown
Refinement Cycle Pattern:
1. User makes changes in Scribe Studio
2. Agent detects Scribe changes
3. Agent proposes Media Studio updates
4. User approves Media Studio changes
5. Agent applies changes to Media Studio
6. Generate new references if needed
7. Update keyframes with new context
8. Validate visual consistency
9. Continue until satisfied
```

#### **Refinement Proposals**
```typescript
// Refinement Proposal Pattern
async function proposeScribeSyncChanges(productionId: number, scribeChanges: ScribeChange[]): Proposal {
  const changes: MediaStudioChange[] = [];
  
  for (const change of scribeChanges) {
    switch (change.type) {
      case "character_added":
        changes.push({
          type: "add_character",
          character: change.character,
          sceneKey: change.sceneKey
        });
        break;
      case "location_updated":
        changes.push({
          type: "update_location",
          location: change.location,
          sceneKey: change.sceneKey
        });
        break;
      case "dialogue_changed":
        changes.push({
          type: "update_dialogue",
          dialogue: change.dialogue,
          shotId: change.shotId
        });
        break;
    }
  }
  
  // Propose changes as artifact
  return proposeMediaChange({
    productionId,
    changes,
    instruction: "Update Media Studio to match Scribe manuscript changes"
  });
}
```

## Error Handling and Recovery

### 1. **Common Integration Issues**

#### **Common Problems and Solutions**
```markdown
Common Integration Issues:

Issue: Characters in video but not in manuscript
Solution: Propose adding characters to manuscript or removing from video

Issue: Location description mismatch
Solution: Align descriptions or propose script change

Issue: Dialogue doesn't match script
Solution: Update video dialogue to match script exactly

Issue: Scene structure doesn't match script
Solution: Regenerate scenes from Scribe stations

Issue: Reference images don't match descriptions
Solution: Re-render references with corrected prompts
```

#### **Error Recovery Pattern**
```typescript
// Error Recovery Pattern
async function handleIntegrationError(error: IntegrationError): RecoveryAction {
  switch (error.type) {
    case "character_mismatch":
      return {
        action: "propose_alignment",
        message: `Character "${error.entityName}" differs between Scribe and Media Studio. Propose alignment?`
      };
    
    case "dialogue_mismatch":
      return {
        action: "re_sync_dialogue",
        message: `Dialogue in shot ${error.shotId} doesn't match script. Re-sync from Scribe?`
      };
    
    case "structure_mismatch":
      return {
        action: "regenerate_scenes",
        message: `Scene structure doesn't match Scribe stations. Regenerate from Scribe?`
      };
    
    case "reference_mismatch":
      return {
        action: "re_render_reference",
        message: `Reference for "${error.entityName}" doesn't match description. Re-render reference?`
      };
    
    default:
      return {
        action: "manual_intervention",
        message: `Complex integration error: ${error.message}. Manual review required.`
      };
  }
}
```

### 2. **Data Loss Prevention**

#### **Backup and Recovery**
```markdown
Data Loss Prevention:
- Regular snapshots of production state
- Version history for key decisions
- Audit trail of all cross-studio changes
- Rollback capability for mistakes
- Conflict detection and resolution
```

#### **State Recovery Pattern**
```typescript
// State Recovery Pattern
async function recoverProductionState(productionId: number, timestamp: Date): RecoveryResult {
  // Get production state at given timestamp
  const snapshot = await getProductionSnapshot(productionId, timestamp);
  
  if (!snapshot) {
    return {
      success: false,
      message: "No snapshot found for given timestamp"
    };
  }
  
  // Restore production from snapshot
  await restoreProductionFromSnapshot(productionId, snapshot);
  
  // Validate restored state
  const validation = await validateProductionState(productionId);
  if (!validation.valid) {
    return {
      success: false,
      message: `Restored state is invalid: ${validation.issues.join(", ")}`
    };
  }
  
  return {
    success: true,
    message: "Production state successfully recovered"
  };
}
```

## Best Practices Summary

### 1. **Character Management**
- ✅ Always sync characters from Scribe as the authoritative source
- ✅ Generate and approve character references before video generation
- ✅ Track character usage in approved takes to prevent accidental deletion
- ✅ Keep character descriptions consistent between manuscript and references
- ✅ Use character anchors for continuity tracking

### 2. **Location Management**
- ✅ Sync locations from Scribe with script accuracy
- Generate location references without people or text
- Add implicit locations used in scenes but not in manuscript
- Maintain location descriptions between script and visual production
- Ensure location consistency across scenes

### 3. **Dialogue Management**
- ✅ Extract dialogue from Scribe with proper formatting
- Convert dialogue to Media Studio format with speaker and delivery
- Validate dialogue against character list
- Ensure dialogue length fits shot duration (2.5 words/second max)
- Assign dialogue to shots where it naturally occurs

### 4. **Scene Structure**
- ✅ Convert Scribe stations to scenes with proper metadata
- Extract location, time-of-day, and mood from station content
- Generate plot points at logical story beats
- Link scenes back to originating stations for traceability
- Maintain scene order and numbering

### 5. **Cross-Studio Consistency**
- ✅ Validate consistency between Scribe and Media Studio
- Propose changes when inconsistencies are detected
- Allow user to decide on conflict resolution
- Maintain bidirectional sync between studios
- Document all cross-studio changes

### 6. **Error Handling**
- ✅ Handle integration errors gracefully with recovery options
- Provide clear error messages and suggested solutions
- Implement state recovery mechanisms
- Prevent data loss through regular snapshots
- Allow user intervention for complex issues

## Implementation Checklist

### 1. **Setup Requirements**
- [ ] Scribe Studio integration configured
- [ ] Media Studio Scribe document linking functional
- [ ] Character extraction and synchronization working
- [ ] Location extraction and synchronization working
- [ ] Dialogue extraction and formatting working
- [ ] Scene creation from Scribe stations working
- [ ] Reference generation integration working

### 2. **Validation Requirements**
- [ ] Character consistency validation implemented
- [ ] Location consistency validation implemented
- [ ] Dialogue validation against character list
- [   ] Scene structure validation implemented
- [ ] Cross-studio consistency checks working
- [ ] Orphan entity detection working

### 3. **Recovery Requirements**
- [ ] Error recovery patterns implemented
- [ ] State recovery mechanisms working
- [ ] Snapshot and rollback capability working
- [ ] Conflict detection and resolution working
- [ ] User intervention workflows working

This documentation provides a comprehensive guide for agents to effectively integrate Scribe Studio manuscript management with Media Studio video production while maintaining narrative consistency, visual quality, and user control.

---

**Document Version**: 1.0  
**Last Updated**: 2026-09-13  
**Related Systems**: Scribe Studio, Media Studio, CREW  
**Maintained By**: Media Studio Development Team
