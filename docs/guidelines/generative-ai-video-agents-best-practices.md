# Generative AI Video Agents Best Practices for Media Studio

## Overview

This document provides comprehensive best practices for agents that support Media Studio's generative AI video capabilities. It covers prompt engineering, workflow optimization, quality control, and integration patterns for agents working with video generation tools like fal.ai Seedance and ComfyUI.

## Core Principles

### 1. **Safety-First Approach**
- **No Direct Rendering**: Agents must never render video directly without user approval
- **Artifact-Based Changes**: All changes must be proposed as artifacts for user review
- **Budget Awareness**: Always check budget limits before requesting renders
- **User Consent**: Every video generation requires explicit user approval

### 2. **Quality Over Speed**
- **Reference-Based Consistency**: Always use approved character/location references
- **Style Continuity**: Maintain production's visual style across all shots
- **Character Anchoring**: Track character continuity through proper anchoring
- **Prompt Clarity**: Be specific and descriptive in video prompts

### 3. **Workflow Best Practices**
- **Approval Gates**: Render only after keyframe and reference approval
- **Progressive Enhancement**: Start with keyframes, then shots, then takes
- **Incremental Assembly**: Build scenes progressively, not all at once
- **User Control**: Maintain user agency over creative decisions

## Prompt Engineering Best Practices

### Video Prompt Structure

#### **The Ideal Prompt Formula**
```
Setting: [location, time of day]
Mood: [emotional tone]
Look: [visual style guide]
Characters: [character name, description]
Shot: [framing, lens, camera motion]
Action: [what happens in the shot]
Dialogue: [character]: "line" (delivery)
Avoid: [negative constraints]
```

#### **Example Well-Structured Prompt**
```
Setting: Archive rooftop, night
Mood: Tense, cold cyan light
Look: 35mm film grain, teal and amber tones
Characters: Elena, a courier in a rain-soaked trench coat with dark hair
Shot: Medium close-up, 50mm lens, camera orbit left
Action: Elena crouches behind the parapet as a drone sweeps its light
Dialogue: Elena (whispering): "They found the cylinder."
Avoid: Text overlays, logos, watermarks
```

### Keyframe Prompt Guidelines

#### **Reference Image Integration**
- Always mention reference images in order: "image 1 is Elena's appearance, image 2 is the setting"
- Use character references for face continuity
- Use location references for environmental consistency
- Include previous keyframe when appropriate for temporal continuity

#### **Character Descriptions**
- Be specific about appearance: "auburn hair in a ponytail, blue eyes, freckles"
- Include costume details: "navy blue tactical jacket, cargo pants"
- Note distinctive features: "small scar on left cheek, silver ring on right hand"
- Keep descriptions concise but descriptive

### Shot Prompt Guidelines

#### **Framing and Camera Movement**
- Specify exact framing: "medium close-up", "wide establishing shot", "extreme close-up"
- Define camera motion: "slow pan right", "handheld shake", "smooth dolly in"
- Include lens information: "50mm lens", "85mm portrait lens", "24mm wide angle"
- Avoid ambiguous terms like "dynamic shot" or "interesting angle"

#### **Action Descriptions**
- Use present tense: "She runs" not "She ran"
- Be specific about movement: "She sprints across the rooftop" not "She moves quickly"
- Include emotional subtext: "She looks around anxiously"
- Avoid over-directing: Let the AI interpret some creative details

#### **Dialogue Handling**
- **Format**: Character (delivery): "Line text"
- **Examples**: 
  - `Elena (whispering): "They found the cylinder."`
  - `Director (shouting): "Cut! That was perfect."`
  - `Hero (hesitant): "I... I don't know."`
- **Word Count**: Aim for 2.5 words per second maximum
- **Delivery Cues**: Include emotional tone and speaking style

## Workflow Patterns

### 1. **Production Creation Workflow**

#### **Step-by-Step Process**
1. **Initialize Production**: Use `mount_media_studio` with production title
2. **Set Visual Style**: Define look in Story tab (colors, lighting, mood)
3. **Import Characters**: Link Scribe manuscript for character definitions
4. **Create Scenes**: Set up scene structure with locations and time of day
5. **Render References**: Generate and approve character/location reference images
6. **Storyboard**: Create keyframes for each plot point
7. **Shots**: Convert keyframes to shots with camera direction
8. **Takes**: Request video takes with approval
9. **Assembly**: Cut approved takes into scene reels

#### **Agent Responsibilities**
- **Never Skip Approval**: Always wait for user approval at each stage
- **Monitor Budget**: Track spend against budget limits
- **Validate Prerequisites**: Ensure keyframes approved before takes
- **Provide Context**: Explain what each step accomplishes

### 2. **Shot Creation Workflow**

#### **From Keyframe to Shot**
1. **Verify Keyframe**: Ensure keyframe is approved and has image
2. **Define Shot Parameters**:
   - Duration: 4-15 seconds (Seedance limits)
   - Framing: Match story requirements
   - Camera motion: Appropriate for action
   - Action: Clear description of what happens
3. **Set Seed**: Use consistent seed for re-shoot consistency
4. **Reference Keyframe**: Link to starting keyframe
5. **Request Take**: Submit for user approval

#### **Best Practices**
- **Match Duration to Action**: 5 seconds for simple action, 10+ for complex
- **Appropriate Motion**: Use subtle motion for dialogue, dynamic for action
- **Seed Strategy**: Use deterministic seeds for re-shoot reproducibility
- **Negative Prompts**: Only include specific things to avoid

### 3. **Character Continuity Workflow**

#### **Character Anchor Management**
1. **Character Definition**: Define character in Scribe manuscript
2. **Reference Rendering**: Generate character reference images
3. **Reference Approval**: User approves character reference
4. **Anchor Generation**: System creates character anchor ID
5. **Take Association**: Character anchors included in take requests
6. **Usage Tracking**: System monitors character usage in approved takes
7. **Safe Removal**: Characters can only be removed when not in use

#### **Best Practices**
- **Consistent Naming**: Use same character names across script and studio
- **Reference Quality**: Ensure references show character clearly
- **Anchor Tracking**: Monitor which characters are in use
- **Removal Safety**: Never remove characters used in approved takes

## Quality Control Patterns

### 1. **Validation Before Rendering**

#### **Pre-Render Checklist**
- [ ] Keyframe approved with image
- [ ] Character references approved (if applicable)
- [ ] Location reference approved (if applicable)
- [ ] Budget sufficient for render
- [ ] Duration within provider limits (4-15s for Seedance)
- [ ] Prompt not empty
- [ ] ComfyUI workflow imported (if using ComfyUI)

#### **Agent Validation Logic**
```typescript
// Example validation pattern
if (shot.durationSeconds < 4 || shot.durationSeconds > 15) {
  return "Shot duration must be 4-15 seconds for Seedance rendering";
}
if (!keyframe.approved || !keyframe.imageUrl) {
  return "Approve the keyframe before requesting a take";
}
if (budget.remaining < estimatedCost) {
  return `Insufficient budget: $${budget.remaining} remaining, $${estimatedCost} needed`;
}
```

### 2. **Error Handling Patterns**

#### **Common Error Scenarios**
- **Provider Not Configured**: Inform user simulation mode will be used
- **Budget Exceeded**: Show spend breakdown and suggest budget increase
- **Missing Reference**: Prompt user to approve reference first
- **Workflow Mismatch**: Alert if ComfyUI workflow doesn't match shot type
- **Render Failure**: Suggest re-shoot with adjusted parameters

#### **Error Response Templates**
```
Budget Exceeded:
"This take would exceed the budget. Current spend: $X, remaining: $Y, 
 estimated cost: $Z. Increase the budget or reduce shot duration."

Missing Reference:
"Approve the character reference for [Character Name] before requesting 
this take. The shot includes [Character Name] and requires continuity."

Provider Issue:
"The video provider is not configured. Takes will be simulated (no video, no cost). 
Configure the provider to render actual video."
```

### 3. **Re-shoot Guidance**

#### **Defect Classification**
Use structured defect categories:
- **Character Drift**: Character appearance doesn't match reference
- **Unnatural Motion**: Movement looks artificial or jerky
- **Wrong Framing**: Composition doesn't match shot description
- **Lighting Mismatch**: Lighting inconsistent with scene mood
- **Artifact Glitch**: Visual artifacts, glitches, or quality issues

#### **Re-shoot Prompting**
```
Re-shoot Take 3 with: Reduce camera motion speed, ensure character's 
face is visible throughout, maintain the tense mood from the setting.
Defect: Unnatural motion at 0:03-0:05 seconds.
```

## Budget Management

### 1. **Cost Awareness**

#### **Cost Calculation Guidelines**
- **Seedance Costs**: ~$0.30/second at 720p, ~$0.68/second at 1080p
- **Keyframe Costs**: Vary by provider, usually minimal
- **Reference Costs**: Count against budget like keyframes
- **Budget Tracking**: Monitor both spent and pending approval costs

#### **Agent Budget Pattern**
```typescript
const estimatedCost = shot.durationSeconds * provider.estimateCents(shot.durationSeconds);
const committedSpend = spentTakes + pendingTakes;
const remainingBudget = budgetLimit - committedSpend;

if (estimatedCost > remainingBudget) {
  return `Cannot request take: $${estimatedCost} needed, $${remainingBudget} remaining`;
}
```

### 2. **Optimization Strategies**

#### **Cost-Effective Practices**
- **Reuse Keyframes**: Use same keyframe for multiple shots when appropriate
- **Optimal Duration**: Use minimum duration that conveys the action
- **Batch Similar Shots**: Reuse camera setups across similar shots
- **Simulation First**: Use simulation mode for testing before real renders

#### **Budget Allocation Recommendations**
- **Test Shots**: Allocate 20% of budget for experimental shots
- **Core Shots**: Allocate 60% for essential story coverage
- **Backup Takes**: Allocate 20% for re-shoots and alternatives
- **Reference Images**: Budget separately for reference renders

## Provider-Specific Guidelines

### 1. **fal.ai Seedance**

#### **Configuration Requirements**
- **API Key**: Must be configured in environment variables
- **Duration Limits**: 4-15 seconds per take
- **Aspect Ratios**: Supports 16:9, 9:16, 2.39:1, 4:3, 1:1
- **Audio Generation**: Enabled by default for dialogue

#### **Best Practices**
- **Duration Choice**: Use 5 seconds for simple actions, 10+ for complex
- **Resolution Choice**: 720p for preview, 1080p for final output
- **Audio Sync**: Ensure dialogue word count fits duration
- **Reference Usage**: Always include character references for continuity

#### **Common Issues and Solutions**
- **Audio Sync Issues**: Reduce dialogue word count to 2.5 words/second
- **Face Drift**: Use approved character references with high-quality images
- **Motion Quality**: Add camera motion instructions for better movement
- **Style Inconsistency**: Strengthen the "Look" prompt section

### 2. **ComfyUI Workflows**

#### **Workflow Requirements**
- **Workflow Import**: Must be imported before requesting takes
- **Mapping Configuration**: Ensure workflow mapping matches shot requirements
- **Start Image**: Keyframe required if workflow expects start image
- **End Image**: Optional for transitions between keyframes

#### **Best Practices**
- **Workflow Selection**: Choose appropriate workflow for shot type
- **Node Configuration**: Ensure nodes match production requirements
- **Parameter Tuning**: Adjust parameters for visual quality vs. speed
- **Output Format**: Configure resolution and format settings

#### **Workflow Types**
- **Image-to-Video**: Requires approved keyframe as start image
- **Text-to-Video**: Works without reference images
- **Animation Workflows**: Specialized for specific animation styles
- **Custom Workflows**: User-defined for specialized needs

## Agent Integration Patterns

### 1. **CREW Room Integration**

#### **Artifact-Based Changes**
- **Never Direct Mutations**: All changes must be proposed as artifacts
- **User Approval Required**: Changes apply only after user presses "Apply"
- **Artifact Structure**: Include production context and specific changes
- **Change Descriptions**: Clear, specific descriptions of what will change

#### **Mount Media Studio Pattern**
```typescript
// Mount Media Studio beside CREW conversation
mount_media_studio({
  productionTitle: "My Film",
  create: true,
  aspectRatio: "16:9"
})
// Response: Media Studio opens, production created
```

#### **Propose Media Change Pattern**
```typescript
// Propose a change to scene/shot/plot point
propose_media_change({
  selection: { sceneId: 123, sceneKey: "SCENE-01" },
  instruction: "Change the action to 'Hero runs toward the exit'"
})
// Response: Change proposal card appears, user can apply
```

### 2. **User Interaction Patterns**

#### **Clear Communication**
- **Status Updates**: Always inform user of current state
- **Next Steps**: Guide user on what to do next
- **Error Explanations**: Explain why an action failed and how to fix
- **Progress Tracking**: Report on rendering progress and completion

#### **Example Communication**
```
Good: "I've drafted a change to SCENE-01: set the mood to 'tense, dramatic'. 
The change is on the card for your review. Press Apply to save it."

Bad: "I changed the scene." (Too vague, no approval mentioned)
```

### 3. **Safety Patterns**

#### **Multi-Agent Coordination**
- **No Racing Conditions**: Ensure only one agent modifies at a time
- **State Synchronization**: Refresh production state before making changes
- **Conflict Resolution**: Handle concurrent modification gracefully
- **User Authority**: User always has final say over changes

#### **Organization Scoping**
- **Tenant Isolation**: Never access data across organizations
- **Permission Checking**: Verify user has edit permissions
- **Resource Allocation**: Respect per-organization resource limits
- **Audit Trail**: Log all actions for accountability

## Advanced Patterns

### 1. **Batch Operations**

#### **Multi-Shot Request Pattern**
```typescript
// Request multiple takes with approval
const shots = [
  { shotId: 1, prompt: "Shot 1 action" },
  { shotId: 2, prompt: "Shot 2 action" },
  { shotId: 3, prompt: "Shot 3 action" }
];

// Process sequentially with approval
for (const shot of shots) {
  await requestTake(shot);
  await waitForApproval(); // User approval required
}
```

#### **Batch Approval Workflow**
- **Dailies Review**: Present multiple shots for batch approval
- **Grouped Decisions**: Allow user to approve/reject multiple at once
- **Consistency Checks**: Ensure batch decisions maintain visual consistency
- **Rollback Capability**: Ability to undo batch decisions

### 2. **Style Continuity**

#### **Project Style Bible**
- **Canonical Characters**: Define character appearances in style bible
- **Visual Consistency**: Maintain consistent look across all shots
- **Reference Reuse**: Use approved style bible references
- **Style Promotion**: Promote production style to project level

#### **Continuity Enforcement**
- **Character Anchors**: Track character continuity through all takes
- **Location Consistency**: Maintain consistent location appearance
- **Time of Day**: Ensure lighting matches scene time
- **Mood Alignment**: Keep emotional tone consistent with scene mood

### 3. **Error Recovery**

#### **Render Failure Handling**
- **Automatic Retry**: Implement exponential backoff for transient failures
- **Error Classification**: Distinguish between user errors and system errors
- **Fallback Strategies**: Have backup approaches for different failure types
- **User Notification**: Clearly communicate failure reasons and solutions

#### **State Recovery**
- **Checkpoint System**: Save state at key decision points
- **Rollback Capability**: Ability to revert to previous state
- **Conflict Resolution**: Handle state conflicts from concurrent changes
- **Data Validation**: Ensure data integrity before state changes

## Performance Optimization

### 1. **Efficient Workflow**

#### **Parallel Processing**
- **Independent Operations**: Run independent renders in parallel
- **Sequential Dependencies**: Sequence dependent operations properly
- **Resource Management**: Limit concurrent operations to prevent overload
- **Priority Queuing**: Prioritize critical shots over optional ones

#### **Caching Strategies**
- **Reference Caching**: Cache approved reference images
- **Prompt Caching**: Reuse similar prompts when appropriate
- **State Caching**: Cache production state to reduce queries
- **Metadata Caching**: Cache frequently accessed metadata

### 2. **Resource Management**

#### **Memory Management**
- **Image Management**: Handle large images efficiently
- **Video Processing**: Stream video processing when possible
- **Cleanup**: Clean up temporary resources promptly
- **Memory Limits**: Respect system memory constraints

#### **Network Optimization**
- **Batch Requests**: Combine multiple requests when possible
- **Compression**: Use compression for large payloads
- **Connection Pooling**: Reuse connections for repeated requests
- **Timeout Handling**: Set appropriate timeouts for network operations

## Security Best Practices

### 1. **Data Protection**

#### **Sensitive Information**
- **No Secrets in Prompts**: Never include API keys or secrets in prompts
- **PII Protection**: Avoid including personally identifiable information
- **Content Moderation**: Ensure generated content is appropriate
- **Audit Logging**: Log all operations for security auditing

#### **Access Control**
- **Organization Scoping**: Enforce organization-level access control
- **User Permissions**: Verify user has required permissions
- **Resource Ownership**: Ensure user can access requested resources
- **Session Validation**: Validate user session before operations

### 2. **Content Safety**

#### **Generated Content Guidelines**
- **Appropriate Content**: Ensure generated content is appropriate
- **Brand Safety**: Maintain brand guidelines if applicable
- **Copyright Compliance**: Respect copyright and licensing
- **Quality Standards**: Maintain acceptable quality standards

#### **Content Moderation**
- **Pre-Generation Checks**: Validate prompts before generation
- **Post-Generation Review**: Review generated content for issues
- **User Reporting**: Provide mechanism for content concerns
- **Moderation Workflow**: Clear process for handling flagged content

## Testing and Validation

### 1. **Agent Testing**

#### **Unit Testing**
- **Prompt Validation**: Test prompt generation logic
- **Cost Calculation**: Verify cost estimation accuracy
- **Error Handling**: Test error scenarios and recovery
- **State Management**: Verify state changes are correct

#### **Integration Testing**
- **API Testing**: Test integration with video providers
- **Workflow Testing**: Test complete production workflows
- **Multi-Agent Testing**: Test agent coordination
- **Performance Testing**: Test under realistic load

### 2. **Quality Assurance**

#### **Output Validation**
- **Video Quality**: Assess generated video quality
- **Prompt Accuracy**: Verify output matches prompt
- **Style Consistency**: Check visual consistency
- **Continuity Validation**: Verify character/location continuity

#### **User Acceptance Testing**
- **Usability Testing**: Test user interface and workflows
- **Satisfaction Monitoring**: Track user satisfaction metrics
- **Feedback Collection**: Gather user feedback systematically
- **Continuous Improvement**: Iterate based on feedback

## Monitoring and Analytics

### 1. **Performance Metrics**

#### **Key Metrics to Track**
- **Render Success Rate**: Percentage of successful renders
- **Render Time**: Average time to complete renders
- **Cost Efficiency**: Cost per second of video
- **User Satisfaction**: User ratings and feedback

#### **Monitoring Patterns**
- **Real-time Monitoring**: Monitor active renders
- **Error Tracking**: Track and categorize errors
- **Performance Baselines**: Establish performance baselines
- **Alerting**: Set up alerts for performance issues

### 2. **Usage Analytics**

#### **Usage Patterns**
- **Popular Shot Types**: Most common shot configurations
- **Common Durations**: Most used shot durations
- **Style Preferences**: Popular visual styles
- **Character Usage**: Most used characters

#### **Optimization Opportunities**
- **Cost Optimization**: Identify cost-saving opportunities
- **Quality Improvements**: Find areas for quality enhancement
- **Workflow Efficiency**: Streamline common workflows
- **Resource Allocation**: Optimize resource distribution

## Documentation and Training

### 1. **Agent Documentation**

#### **Clear Instructions**
- **API Documentation**: Document all API interactions
- **Workflow Guides**: Step-by-step workflow documentation
- **Troubleshooting**: Common issues and solutions
- **Best Practices**: Document dos and don'ts

#### **Code Examples**
- **Prompt Examples**: Example prompts for different scenarios
- **Integration Examples**: Example agent integrations
- **Error Handling**: Example error handling patterns
- **Optimization Examples**: Example optimization techniques

### 2. **User Training**

#### **User Guides**
- **Getting Started**: Beginner-friendly introduction
- **Advanced Features**: Advanced feature documentation
- **Best Practices**: User best practices
- **FAQ**: Common questions and answers

#### **Video Tutorials**
- **Workflow Walkthroughs**: Step-by-step video guides
- **Feature Demonstrations**: Feature capability demonstrations
- **Troubleshooting Videos**: Video-based troubleshooting
- **Expert Tips**: Advanced techniques and tips

## Conclusion

Following these best practices ensures that agents supporting Media Studio's generative AI video capabilities:

✅ **Produce High-Quality Content**: Consistent, professional video output  
✅ **Maintain User Control**: Users always have final approval authority  
✅ **Operate Efficiently**: Optimal use of resources and budget  
✅ **Ensure Safety**: Proper error handling and data protection  
✅ **Scale Effectively**: Patterns that work at scale  
✅ **Deliver Value**: Focus on what matters to users  

The key principles are safety, quality, and user agency. Agents should assist and guide, but never override user decisions. Every video generation should be intentional, approved, and valuable to the production.

---

**Document Version**: 1.0  
**Last Updated**: 2026-09-13  
**Related Systems**: Media Studio, CREW, fal.ai Seedance, ComfyUI  
**Maintained By**: Media Studio Development Team
