# Reference Image Management Best Practices for Media Studio

## Overview

This document provides comprehensive best practices for agents managing reference images in Media Studio. It covers character and location reference generation, approval workflows, quality standards, and maintaining visual consistency across video productions.

## Core Principles

### 1. **Reference First Approach**
- **Approve Before Use**: References must be approved before video generation
- **Canonical Authority**: Approved references become the visual authority
- **Consistency Priority**: References ensure visual consistency across takes
- **Quality Standards**: References must meet production quality requirements

### 2. **Quality Over Speed**
- **High Quality**: Generate high-quality references from the start
- **Clear Visibility**: References must show key elements clearly
- **Accurate Representation**: References must accurately depict characters/locations
- **Professional Standards**: Meet broadcast-quality reference standards

### 3. **Strategic Generation**
- **Generate When Needed**: Generate references when needed, not in bulk
- **Batch Similar References**: Group similar reference requests for efficiency
- **Iterative Refinement**: Iterate on references until quality standards met
- **User Approval**: User must approve references before production use

## Character Reference Management

### 1. **Character Reference Generation**

#### **Character Reference Prompt Structure**
```markdown
Character Reference Prompt Template:
A character reference sheet for [Character Name][, optional description]

Visual Requirements:
- A full-length front view and a head-and-shoulders close-up side by side
- On a plain neutral background in even light
- So the face, hair and wardrobe are clear
- No text, labels or borders

Character Description Guidelines:
- Physical Appearance: Height, build, hair color/style, eye color
- Costume Details: Clothing style, colors, accessories
- Distinguishing Features: Scars, tattoos, distinctive traits
- Age Range: Approximate age for visual reference
- Expression: Neutral expression for base reference
- Pose: Standing naturally, hands visible
```

#### **Character Reference Prompt Examples**
```markdown
Example 1 - Action Hero:
A character reference sheet for Alex Chen, a courier in a rain-soaked trench coat
with dark hair in a ponytail and athletic build, approximately 30 years old.
A full-length front view and a head-and-shoulders close-up side by side, on a plain
neutral background in even light, so the face, hair and wardrobe are clear.
No text, labels or borders.

Example 2 - Fantasy Character:
A character reference sheet for Seraphina, an elven mage with silver hair and blue
eyes, wearing flowing robes with intricate embroidery, approximately 500 years old
but appearing as young adult. A full-length front view and a head-and-shoulders
close-up side by side, on a plain neutral background in even light, so the face,
hair and wardrobe are clear. No text, labels or borders.

Example 3 - Period Character:
A character reference sheet for Captain Harlow, a 19th-century sea captain with
weathered face, graying beard, and wearing naval uniform, approximately 45 years
old. A full-length front view and a head-and-shoulders close-up side by side,
on a plain neutral background in even light, so the face, hair and wardrobe are
clear. No text, labels or borders.
```

### 2. **Character Reference Quality Standards**

#### **Character Reference Quality Checklist**
```markdown
Character Reference Quality Checklist:
□ Full-body view shows entire character clearly
□ Close-up shows face details (eyes, expression, skin tone)
□ Hair is visible and styled appropriately
□ Wardrobe is visible and accurate to description
□ Hands are visible in full-body view
□ Lighting is even and flattering (no harsh shadows)
□ Background is neutral and non-distracting
□ Character is in neutral expression
□ No text, labels, or watermarks
□ Resolution meets production standards (at least 1080p)
□ Face is clearly visible and recognizable
□ Skin tones are accurate and natural
□ Costume details are visible and clear
□ Posture is natural and representative
□ Character is centered and properly framed
```

#### **Character Reference Quality Assessment**
```typescript
// Character Reference Quality Assessment Pattern
async function assessCharacterReference(reference: ReferenceView): QualityAssessment {
  const issues: string[] = [];
  const warnings: string[] = [];
  
  if (!reference.imageUrl) {
    return {
      passes: false,
      issues: ["Reference has no image yet"],
      warnings: [],
      recommendation: "Wait for image generation"
    };
  }
  
  // Analyze image for quality
  const analysis = await analyzeImage(reference.imageUrl);
  
  // Check for people (should be exactly one)
  if (analysis.people !== 1) {
    issues.push(`Reference should show exactly one character, detected ${analysis.people}`);
  }
  
  // Check for text
  if (analysis.text > 0) {
    issues.push("Reference should not contain text");
  }
  
  // Check face visibility
  if (!analysis.faceVisible) {
    issues.push("Character face is not clearly visible");
  }
  
  // Check lighting quality
  if (analysis.lightingQuality < 0.7) {
    warnings.push("Lighting could be improved for better visibility");
  }
  
  // Check background
  if (analysis.backgroundComplexity > 0.5) {
    warnings.push("Background is complex; neutral background preferred");
  }
  
  // Check resolution
  if (analysis.resolution < 1080) {
    issues.push(`Resolution too low: ${analysis.resolution}p, minimum 1080p required`);
  }
  
  return {
    passes: issues.length === 0,
    issues,
    warnings,
    recommendation: issues.length > 0 
      ? `Render new reference: ${issues.join(", ")}`
      : warnings.length > 0
        ? `Approve with caution: ${warnings.join(", ")}`
        : "Approve reference"
  };
}
```

### 3. **Character Reference Approval Workflow**

#### **Reference Approval Process**
```markdown
Character Reference Approval Workflow:
1. Reference generation completes
2. System automatically assesses quality
3. Assessment results shown to user
4. User reviews reference image
5. User approves or requests re-render
6. If approved, reference becomes canonical
7. If rejected, generate new reference with adjusted prompt
8. Repeat until reference meets quality standards
```

#### **Reference Approval Decision Pattern**
```typescript
// Reference Approval Decision Pattern
async function shouldApproveCharacterReference(reference: ReferenceView, character: CharacterView): ApprovalDecision {
  // Quality assessment
  const quality = await assessCharacterReference(reference);
  if (!quality.passes) {
    return {
      approved: false,
      reason: quality.issues.join("; "),
      recommendation: quality.recommendation
    };
  }
  
  // Consistency check against character description
  const consistency = await checkCharacterConsistency(reference, character);
  if (!consistency.matches) {
    return {
      approved: false,
      reason: consistency.issues.join("; "),
      recommendation: "Render new reference with adjusted description"
    };
  }
  
  // Style consistency check
  const style = await checkStyleConsistency(reference);
  if (!style.matches) {
    return {
      approved: false,
      reason: style.issues.join("; "),
      recommendation: "Render new reference with production style"
    };
  }
  
  return {
    approved: true,
    reason: "Reference meets all quality and consistency standards",
    recommendation: "Approve for production use"
  };
}
```

### 4. **Character Reference Variation**

#### **When to Generate Reference Variations**
```markdown
Reference Variation Scenarios:
- Character costume changes during story
- Character appearance changes (aging, injury, transformation)
- Different time periods or settings
- Alternative character designs for comparison
- Special character states (wet, dirty, damaged)
- Expressive variations for emotional scenes
```

#### **Reference Variation Prompt Pattern**
```typescript
// Reference Variation Generation Pattern
async function generateCharacterVariation(baseReference: ReferenceView, variation: CharacterVariation): ReferenceView {
  const basePrompt = baseReference.prompt;
  const variationModifier = getVariationModifier(variation);
  
  const modifiedPrompt = `${basePrompt}\n\nVariation: ${variationModifier}`;
  
  return await generateReference({
    kind: "character",
    name: baseReference.name,
    prompt: modifiedPrompt,
    style: baseReference.style
  });
}

function getVariationModifier(variation: CharacterVariation): string {
  switch (variation.type) {
    case "costume_change":
      return `Character wearing ${variation.costumeDescription}`;
    case "age_progression":
      return `Character appearing ${variation.ageDifference} years ${variation.direction}`;
    case "emotional_state":
      return `Character with ${variation.emotion} expression`;
    case "environmental_effect":
      return `Character ${variation.effect} (e.g., wet, dirty, injured)`;
    default:
      return "";
  }
}
```

## Location Reference Management

### 1. **Location Reference Generation**

#### **Location Reference Prompt Structure**
```markdown
Location Reference Prompt Template:
A location reference for [Location Name][, optional description]

Visual Requirements:
- A wide establishing view with no people in it
- Showing the layout, materials and light of the place
- On a plain or appropriate environmental background
- No text, labels or borders

Location Description Guidelines:
- Physical Layout: Architecture, furniture, spatial arrangement
- Materials: Building materials, textures, surfaces
- Lighting: Natural or artificial light sources
- Atmosphere: Mood, feeling, emotional quality
- Time-of-Day: Dawn, midday, golden hour, dusk, night
- Context: How location relates to story/characters
- Key Features: Distinctive elements that identify the location
```

#### **Location Reference Prompt Examples**
```markdown
Example 1 - Interior Location:
A location reference for the Archive rooftop, a flat concrete rooftop with
parapets and air conditioning units, overlooking a cyberpunk city skyline
at night with neon lights reflecting off wet surfaces. A wide establishing
view with no people in it, showing the layout, materials and light of the
place. No text, labels or borders.

Example 2 - Exterior Location:
A location reference for the abandoned warehouse, a large industrial
building with broken windows, rusted metal exterior, and overgrown
vegetation, during golden hour with warm light streaming through cracks.
A wide establishing view with no people in it, showing the layout, materials
and light of the place. No text, labels or borders.

Example 3 - Fantasy Location:
A location reference for the Crystal Throne Room, an ornate chamber with
crystal pillars, glowing runes on the floor, and a throne made of pure
crystal, illuminated by magical blue light from above. A wide establishing
view with no people in it, showing the layout, materials and light of the
place. No text, labels or borders.
```

### 2. **Location Reference Quality Standards**

#### **Location Reference Quality Checklist**
```markdown
Location Reference Quality Checklist:
□ Wide establishing view shows entire location
□ Key features are visible and identifiable
□ Materials and textures are visible
□ Lighting is appropriate for location type
□ No people in the reference
□ No text, labels, or watermarks
□ Resolution meets production standards (at least 1080p)
□ Spatial layout is clear and understandable
□ Atmosphere matches location description
□ Time-of-day is consistent with description
□ Background doesn't distract from location
□ Perspective shows location effectively
□ Depth and scale are apparent
□ Lighting quality is good (not too dark/bright)
```

#### **Location Reference Quality Assessment**
```typescript
// Location Reference Quality Assessment Pattern
async function assessLocationReference(reference: ReferenceView): QualityAssessment {
  const issues: string[] = [];
  const warnings: string[] = [];
  
  if (!reference.imageUrl) {
    return {
      passes: false,
      issues: ["Reference has no image yet"],
      warnings: [],
      recommendation: "Wait for image generation"
    };
  }
  
  // Analyze image for quality
  const analysis = await analyzeImage(reference.imageUrl);
  
  // Check for people (should be zero)
  if (analysis.people > 0) {
    issues.push(`Location reference should not contain people, detected ${analysis.people}`);
  }
  
  // Check for text
  if (analysis.text > 0) {
    issues.push("Reference should not contain text");
  }
  
  // Check for establishing view
  if (!analysis.isEstablishingShot) {
    warnings.push("Reference may not be a wide establishing view");
  }
  
  // Check lighting quality
  if (analysis.lightingQuality < 0.6) {
    issues.push("Lighting is too poor to see location clearly");
  }
  
  // Check resolution
  if (analysis.resolution < 1080) {
    issues.push(`Resolution too low: ${analysis.resolution}p, minimum 1080p required`);
  }
  
  // Check spatial clarity
  if (analysis.spatialClarity < 0.7) {
    warnings.push("Spatial layout could be clearer");
  }
  
  return {
    passes: issues.length === 0,
    issues,
    warnings,
    recommendation: issues.length > 0 
      ? `Render new reference: ${issues.join(", ")}`
      : warnings.length > 0
        ? `Approve with caution: ${warnings.join(", ")}`
        : "Approve reference"
  };
}
```

### 3. **Location Reference Approval Workflow**

#### **Location Reference Approval Process**
```markdown
Location Reference Approval Workflow:
1. Reference generation completes
2. System automatically assesses quality
3. Assessment results shown to user
4. User reviews reference image
5. User approves or requests re-render
6. If approved, reference becomes canonical
7. If rejected, generate new reference with adjusted prompt
8. Repeat until reference meets quality standards
```

#### **Location Reference Approval Decision Pattern**
```typescript
// Location Reference Approval Decision Pattern
async function shouldApproveLocationReference(reference: ReferenceView, location: LocationView): ApprovalDecision {
  // Quality assessment
  const quality = await assessLocationReference(reference);
  if (!quality.passes) {
    return {
      approved: false,
      reason: quality.issues.join("; "),
      recommendation: quality.recommendation
    };
  }
  
  // Consistency check against location description
  const consistency = await checkLocationConsistency(reference, location);
  if (!consistency.matches) {
    return {
      approved: false,
      reason: consistency.issues.join("; "),
      recommendation: "Render new reference with adjusted description"
    };
  }
  
  // Style consistency check
  const style = await checkStyleConsistency(reference);
  if (!style.matches) {
    return {
      approved: false,
      reason: style.issues.join("; "),
      recommendation: "Render new reference with production style"
    };
  }
  
  return {
    approved: true,
    reason: "Reference meets all quality and consistency standards",
    recommendation: "Approve for production use"
  };
}
```

### 4. **Location Reference Variation**

#### **When to Generate Location Variations**
```markdown
Location Variation Scenarios:
- Different time-of-day (day vs. night versions)
- Weather conditions (sunny, rainy, foggy, snowy)
- Seasonal changes (spring, summer, autumn, winter)
- Damage or wear (pristine vs. damaged)
- Lighting changes (natural vs. artificial)
- Story progression (location changes over time)
```

#### **Location Variation Prompt Pattern**
```typescript
// Location Variation Generation Pattern
async function generateLocationVariation(baseReference: ReferenceView, variation: LocationVariation): ReferenceView {
  const basePrompt = baseReference.prompt;
  const variationModifier = getVariationModifier(variation);
  
  const modifiedPrompt = `${basePrompt}\n\nVariation: ${variationModifier}`;
  
  return await generateReference({
    kind: "location",
    name: baseReference.name,
    prompt: modifiedPrompt,
    style: baseReference.style
  });
}

function getVariationModifier(variation: LocationVariation): string {
  switch (variation.type) {
    case "time_of_day":
      return `Location during ${variation.timeOfDay} with appropriate lighting`;
    case "weather":
      return `Location with ${variation.weather} weather conditions`;
    case "seasonal":
      return `Location during ${variation.season} with appropriate vegetation and atmosphere`;
    case "damage":
      return `Location showing ${variation.damageDescription} (e.g., battle damage, wear and tear)`;
    case "lighting":
      return `Location with ${variation.lightingType} lighting (e.g., natural, artificial, dramatic)`;
    default:
      return "";
  }
}
```

## Batch Reference Operations

### 1. **Batch Reference Generation**

#### **Batch Generation Strategy**
```markdown
Batch Generation Guidelines:
- Group similar references together for efficiency
- Prioritize main characters before supporting characters
- Generate location references before character references
- Limit batch size to 5-10 references per batch
- Allow user approval between batches
- Track which references in batch have been approved
```

#### **Batch Generation Pattern**
```typescript
// Batch Reference Generation Pattern
async function generateBatchReferences(productionId: number, batchConfig: BatchConfig): BatchResult {
  const results: ReferenceResult[] = [];
  
  // Get entities needing references
  const entities = await getEntitiesNeedingReferences(productionId, batchConfig);
  
  // Generate references in batch
  for (const entity of entities) {
    try {
      const reference = await generateReference({
        kind: entity.kind,
        name: entity.name,
        description: entity.description,
        style: batchConfig.style
      });
      
      results.push({
        entity: entity,
        reference,
        status: "generated",
        error: null
      });
    } catch (error) {
      results.push({
        entity: entity,
        reference: null,
        status: "failed",
        error: error.message
      });
    }
  }
  
  // Show batch results to user
  return {
    total: entities.length,
    successful: results.filter(r => r.status === "generated").length,
    failed: results.filter(r => r.status === "failed").length,
    results
  };
}
```

### 2. **Batch Reference Approval**

#### **Batch Approval Workflow**
```markdown
Batch Approval Process:
1. Present all references in batch together
2. Allow user to review each reference
3. User can approve/reject individually or as a group
4. Approve all that meet quality standards
5. Re-render rejected references individually
6. Continue until all references approved
7. Mark batch as complete
```

#### **Batch Approval Pattern**
```typescript
// Batch Reference Approval Pattern
async function approveBatchReferences(batchId: number, userApprovals: UserApproval[]): BatchApprovalResult {
  const results: ApprovalResult[] = [];
  
  for (const approval of userApprovals) {
    const reference = await getReference(approval.referenceId);
    
    if (approval.approved) {
      await approveReference(reference.id);
      results.push({
        referenceId: reference.id,
        status: "approved",
        message: "Reference approved for production use"
      });
    } else {
      // Generate new reference with user feedback
      const newReference = await regenerateReference(reference.id, approval.feedback);
      results.push({
        referenceId: reference.id,
        status: "re_rendered",
        message: "Reference re-rendered with user feedback",
        newReferenceId: newReference.id
      });
    }
  }
  
  // Mark batch as complete if all approved
  const allApproved = results.every(r => r.status === "approved");
  if (allApproved) {
    await markBatchComplete(batchId);
  }
  
  return {
    batchId,
    total: userApprovals.length,
    approved: results.filter(r => r.status === "approved").length,
    reRendered: results.filter(r => r.status === "re_rendered").length,
    results
  };
}
```

## Reference Versioning

### 1. **Reference Version Management**

#### **Version Control Strategy**
```markdown
Reference Versioning Guidelines:
- Keep approved references as canonical version
- Store rejected references as alternative versions
- Track why references were rejected
- Allow user to switch between versions
- Archive old versions to save space
- Maintain version history for audit trail
```

#### **Reference Version Pattern**
```typescript
// Reference Version Management Pattern
interface ReferenceVersion {
  id: number;
  referenceId: number;
  version: number;
  imageUrl: string;
  prompt: string;
  status: "canonical" | "alternative" | "rejected";
  rejectionReason?: string;
  createdAt: Date;
  approvedBy?: string;
}

async function createReferenceVersion(reference: ReferenceView, version: number): ReferenceVersion {
  return await db.insert(referenceVersions).values({
    referenceId: reference.id,
    version,
    imageUrl: reference.imageUrl,
    prompt: reference.prompt,
    status: "alternative",
    createdAt: new Date()
  }).returning();
}

async function promoteReferenceVersion(versionId: number): ReferenceView {
  const version = await getReferenceVersion(versionId);
  
  // Store current reference as alternative
  const currentReference = await getReference(version.referenceId);
  await createReferenceVersion(currentReference, await getNextVersionNumber(version.referenceId));
  
  // Promote new version as canonical
  await updateReference(version.referenceId, {
    imageUrl: version.imageUrl,
    prompt: version.prompt,
    status: "approved"
  });
  
  // Update version status
  await updateReferenceVersion(versionId, { status: "canonical" });
  
  return await getReference(version.referenceId);
}
```

### 2. **Reference Selection**

#### **Version Selection Criteria**
```markdown
Version Selection Guidelines:
- Canonical version is default for production
- User can select alternative version if needed
- Selection should be justified and documented
- Changing canonical version requires user approval
- Track which version is used in each render
```

#### **Version Selection Pattern**
```typescript
// Reference Version Selection Pattern
async function selectReferenceVersion(referenceId: number, versionId: number, justification: string): SelectionResult {
  const version = await getReferenceVersion(versionId);
  const canonical = await getCanonicalVersion(referenceId);
  
  // Document selection
  await recordVersionSelection({
    referenceId,
    selectedVersionId: versionId,
    previousVersionId: canonical.id,
    justification,
    selectedBy: currentUser.id,
    selectedAt: new Date()
  });
  
  // Promote selected version
  await promoteReferenceVersion(versionId);
  
  return {
    success: true,
    message: `Reference version ${version.version} promoted to canonical`,
    previousVersion: canonical.version,
    newVersion: version.version
  };
}
```

## Reference Quality Monitoring

### 1. **Quality Metrics**

#### **Reference Quality Metrics**
```markdown
Quality Metrics to Track:
- Resolution quality (minimum 1080p)
- Face visibility (for characters)
- Lighting quality (even, appropriate)
- Background appropriateness (neutral or contextual)
- Absence of unwanted elements (people, text, labels)
- Consistency with description
- Style consistency with production
- User approval rate
- Re-render rate
- Generation time
```

#### **Quality Monitoring Pattern**
```typescript
// Reference Quality Monitoring Pattern
async function monitorReferenceQuality(productionId: number): QualityReport {
  const references = await getProductionReferences(productionId);
  
  const metrics = {
    total: references.length,
    approved: references.filter(r => r.status === "approved").length,
    failed: references.filter(r => r.status === "failed").length,
    pending: references.filter(r => r.status === "ready").length,
    averageResolution: 0,
    averageQualityScore: 0,
    reRenderRate: 0
  };
  
  let totalResolution = 0;
  let totalQualityScore = 0;
  let reRenderCount = 0;
  
  for (const reference of references) {
    if (reference.imageUrl) {
      const analysis = await analyzeImage(reference.imageUrl);
      totalResolution += analysis.resolution;
      totalQualityScore += analysis.qualityScore;
    }
    
    if (reference.reRenderCount > 0) {
      reRenderCount++;
    }
  }
  
  metrics.averageResolution = references.length > 0 ? totalResolution / references.length : 0;
  metrics.averageQualityScore = references.length > 0 ? totalQualityScore / references.length : 0;
  metrics.reRenderRate = references.length > 0 ? reRenderCount / references.length : 0;
  
  return metrics;
}
```

### 2. **Quality Alerts**

#### **Quality Alert Conditions**
```markdown
Quality Alert Triggers:
- Average quality score below threshold (0.7)
- High re-render rate (> 30%)
- Multiple failed generations (> 5)
- Inconsistent style across references
- Poor lighting quality (> 50%)
- Low resolution references (> 20%)
```

#### **Quality Alert Pattern**
```typescript
// Quality Alert Pattern
async function checkQualityAlerts(productionId: number): Alert[] {
  const metrics = await monitorReferenceQuality(productionId);
  const alerts: Alert[] = [];
  
  if (metrics.averageQualityScore < 0.7) {
    alerts.push({
      type: "quality",
      severity: "warning",
      message: `Average reference quality is low (${metrics.averageQualityScore.toFixed(2)}). Consider regenerating low-quality references.`
    });
  }
  
  if (metrics.reRenderRate > 0.3) {
    alerts.push({
      type: "efficiency",
      severity: "warning",
      message: `High re-render rate (${(metrics.reRenderRate * 100).toFixed(0)}%). Review reference prompts for improvement.`
    });
  }
  
  const failedReferences = await getFailedReferences(productionId);
  if (failedReferences.length > 5) {
    alerts.push({
      type: "reliability",
      severity: "error",
      message: `${failedReferences.length} references failed to generate. Check image generation provider status.`
    });
  }
  
  return alerts;
}
```

## Reference Storage and Management

### 1. **Storage Strategy**

#### **Reference Storage Guidelines**
```markdown
Storage Best Practices:
- Store references in production asset storage
- Use consistent naming conventions
- Organize by reference type (character/location)
- Include metadata in file names or database
- Implement cache for frequently accessed references
- Archive old versions to save space
- Backup references regularly
```

#### **Reference Storage Pattern**
```typescript
// Reference Storage Pattern
async function storeReference(reference: ReferenceView, imageData: Buffer): StorageResult {
  const filename = `reference_${reference.kind}_${reference.name}_${Date.now()}.png`;
  const path = `productions/${reference.productionId}/references/${reference.kind}/${filename}`;
  
  // Store in asset storage
  const assetId = await storeAsset({
    filename,
    mimeType: "image/png",
    byteSize: imageData.length,
    data: imageData,
    organizationId: reference.organizationId
  });
  
  // Update reference with asset URL
  await updateReference(reference.id, {
    imageUrl: assetUrl(assetId),
    imageAssetId: assetId
  });
  
  return {
    success: true,
    assetId,
    url: assetUrl(assetId)
  };
}
```

### 2. **Reference Cleanup**

#### **Cleanup Strategy**
```markdown
Reference Cleanup Guidelines:
- Archive rejected references after 30 days
- Delete alternative versions after canonical selected
- Keep canonical references for production lifetime
- Clean up temporary generation artifacts
- Monitor storage usage and optimize
- Provide user override for cleanup decisions
```

#### **Reference Cleanup Pattern**
```typescript
// Reference Cleanup Pattern
async function cleanupOldReferences(productionId: number, daysOld: number = 30): CleanupResult {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  // Get references to clean up
  const referencesToClean = await getReferencesOlderThan(productionId, cutoffDate);
  
  let deletedCount = 0;
  let archivedCount = 0;
  
  for (const reference of referencesToClean) {
    if (reference.status === "rejected" || reference.status === "failed") {
      // Delete rejected references
      await deleteReference(reference.id);
      if (reference.imageAssetId) {
        await deleteAsset(reference.imageAssetId);
      }
      deletedCount++;
    } else if (reference.status === "alternative") {
      // Archive alternative versions
      await archiveReference(reference.id);
      archivedCount++;
    }
  }
  
  return {
    deleted: deletedCount,
    archived: archivedCount,
    total: referencesToClean.length
  };
}
```

## Error Handling and Recovery

### 1. **Common Reference Issues**

#### **Common Problems and Solutions**
```markdown
Common Reference Issues:

Issue: Reference generation fails
Solution: Check image generation provider status, try again with adjusted prompt

Issue: Reference doesn't match description
Solution: Adjust prompt with more specific details, re-render

Issue: Reference has unwanted elements (people, text)
Solution: Add negative prompts, re-render with stricter constraints

Issue: Reference quality is poor (low resolution, bad lighting)
Solution: Increase quality settings, adjust lighting parameters

Issue: Reference style doesn't match production
Solution: Add production style to prompt, re-render

Issue: Reference generation is slow
Solution: Reduce batch size, prioritize critical references
```

#### **Error Recovery Pattern**
```typescript
// Reference Error Recovery Pattern
async function handleReferenceError(error: ReferenceError): RecoveryAction {
  switch (error.type) {
    case "generation_failed":
      return {
        action: "retry",
        message: "Reference generation failed. Retry with adjusted parameters?",
        retryWith: {
          prompt: adjustPromptForRetry(error.prompt),
          quality: "high"
        }
      };
    
    case "quality_poor":
      return {
        action: "re_render",
        message: `Reference quality is poor: ${error.issues.join(", ")}. Re-render with improved settings?`,
        retryWith: {
          prompt: enhancePrompt(error.prompt),
          quality: "highest"
        }
      };
    
    case "unwanted_elements":
      return {
        action: "re_render",
        message: `Reference contains unwanted elements: ${error.elements.join(", ")}. Re-render with negative prompts?`,
        retryWith: {
          prompt: addNegativePrompts(error.prompt, error.elements),
          quality: "high"
        }
      };
    
    case "style_mismatch":
      return {
        action: "re_render",
        message: "Reference style doesn't match production. Re-render with production style?",
        retryWith: {
          prompt: addProductionStyle(error.prompt),
          quality: "high"
        }
      };
    
    default:
      return {
        action: "manual_intervention",
        message: `Complex reference error: ${error.message}. Manual review required.`
      };
  }
}
```

### 2. **Reference Validation**

#### **Validation Before Use**
```typescript
// Reference Validation Pattern
async function validateReferenceForUse(referenceId: number, usage: ReferenceUsage): ValidationResult {
  const reference = await getReference(referenceId);
  const issues: string[] = [];
  
  // Check if reference is approved
  if (reference.status !== "approved") {
    issues.push(`Reference is ${reference.status}, not approved for use`);
  }
  
  // Check if reference has image
  if (!reference.imageUrl) {
    issues.push("Reference has no image");
  }
  
  // Check if reference matches usage requirements
  if (usage.requiresFullBody && !reference.hasFullBodyView) {
    issues.push("Reference doesn't have full-body view required for this usage");
  }
  
  if (usage.requiresCloseUp && !reference.hasCloseUpView) {
    issues.push("Reference doesn't have close-up view required for this usage");
  }
  
  // Check if reference is canonical version
  if (usage.requiresCanonical && reference.version !== "canonical") {
    issues.push("Reference is not the canonical version");
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}
```

## Best Practices Summary

### 1. **Character References**
- ✅ Generate references with full-body and close-up views
- ✅ Use neutral background with even lighting
- ✅ Ensure character matches description accurately
- ✅ Approve references before video generation
- ✅ Track character usage for continuity
- ✅ Generate variations for costume/character changes

### 2. **Location References**
- ✅ Generate wide establishing views
- ✅ Ensure no people in location references
- ✅ Show layout, materials, and lighting clearly
- ✅ Match location description accurately
- ✅ Generate variations for time-of-day/weather
- ✅ Approve references before scene setup

### 3. **Quality Standards**
- ✅ Minimum 1080p resolution for all references
- ✅ Clear visibility of key elements
- ✅ Appropriate lighting for reference type
- ✅ No unwanted elements (people, text, labels)
- ✅ Consistent style with production
- ✅ Professional quality standards

### 4. **Workflow**
- ✅ Generate references when needed, not in bulk
- ✅ Get user approval before production use
- ✅ Iterate on references until quality met
- ✅ Track reference versions and changes
- ✅ Monitor quality metrics and alerts
- ✅ Clean up old references regularly

### 5. **Error Handling**
- ✅ Handle generation failures gracefully
- ✅ Provide clear error messages and solutions
- ✅ Implement retry mechanisms for transient failures
- ✅ Validate references before use
- ✅ Allow user intervention for complex issues

## Implementation Checklist

### 1. **Generation Requirements**
- [ ] Character reference generation working
- [ ] Location reference generation working
- [ ] Reference quality assessment implemented
- [ ] Reference approval workflow working
- [ ] Reference variation generation working
- [ ] Batch reference generation working

### 2. **Quality Requirements**
- [ ] Quality assessment implemented
- [ ] Quality metrics tracking working
- [ ] Quality alert system working
- [ ] Reference validation before use
- [ ] Consistency checking implemented
- [ ] Style consistency validation working

### 3. **Management Requirements**
- [ ] Reference versioning implemented
- [ ] Reference selection working
- [ ] Reference storage optimized
- [ ] Reference cleanup automated
- [ ] Reference monitoring working
- [ ] Error recovery patterns implemented

This documentation provides a comprehensive guide for agents to effectively manage reference images in Media Studio while maintaining visual quality, consistency, and production efficiency.

---

**Document Version**: 1.0  
**Last Updated**: 2026-09-13  
**Related Systems**: Media Studio, Scribe Studio, Image Generation Providers  
**Maintained By**: Media Studio Development Team
