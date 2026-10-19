
const fastify = require('fastify')({ logger: true });
const amqp = require('amqplib');
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const { Pool } = require('pg');

// --- Configuration ---
const RABBIT_URL = process.env.RABBIT_URL || 'amqp://guest:guest@localhost:5672';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/oddjob'; // Added DB URL
const INTENT_MAP_PATH = path.join(__dirname, 'intent_map.json');
const QUEUE_NAME = 'intent.raw';

// --- State ---
let intentMap = {};
let dynamicRules = []; // Rules from Redis
let scoreThresholds = []; // Score thresholds from Redis
let channel = null;
let redis = null;
let redisSub = null;

// Session score accumulation (in-memory, keyed by sessionId)
const sessionScores = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Database Connection
const pool = new Pool({ connectionString: DATABASE_URL });

// --- Middleware ---
fastify.register(require('@fastify/cors'), {
    origin: ['http://localhost:5000', 'http://127.0.0.1:5000', 'http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'OPTIONS']
});

// --- Load Semantic Intent Map ---
try {
    const mapData = fs.readFileSync(INTENT_MAP_PATH, 'utf8');
    intentMap = JSON.parse(mapData);
    fastify.log.info(`[Config] Loaded Intent Map v${intentMap.version}`);
} catch (err) {
    fastify.log.error(`[Config] Failed to load Intent Map: ${err.message}`);
    process.exit(1);
}

// --- Redis Connection & Dynamic Rules ---
const connectRedis = async () => {
    try {
        const { getRedisConfig } = await import('@oddjob/shared-redis');
        const redisConfig = getRedisConfig();

        redis = new Redis(redisConfig);
        redisSub = new Redis(redisConfig);

        fastify.log.info('[Redis] Connected');

        // Initial load
        await loadDynamicRules();

        // Subscribe to updates
        redisSub.subscribe('config_updates', (err, count) => {
            if (err) fastify.log.error(`[Redis] Subscribe failed: ${err.message}`);
        });

        redisSub.on('message', async (channel, message) => {
            if (channel === 'config_updates' && message === 'scoring_rules') {
                fastify.log.info('[Config] Received rules update signal');
                await loadDynamicRules();
            }
            if (channel === 'config_updates' && message === 'score_thresholds') {
                fastify.log.info('[Config] Received thresholds update signal');
                await loadScoreThresholds();
            }
        });
    } catch (err) {
        fastify.log.error(`[Redis] Connection failed: ${err.message}`);
    }
};

const loadDynamicRules = async () => {
    try {
        const rulesJson = await redis.get('psychologist:scoring_rules');
        if (rulesJson) {
            dynamicRules = JSON.parse(rulesJson);
            fastify.log.info(`[Config] Loaded ${dynamicRules.length} dynamic rules from Redis`);
        }
    } catch (err) {
        fastify.log.error(`[Config] Failed to load dynamic rules: ${err.message}`);
    }
};

const loadScoreThresholds = async () => {
    try {
        const thresholdsJson = await redis.get('psychologist:score_thresholds');
        if (thresholdsJson) {
            scoreThresholds = JSON.parse(thresholdsJson);
            fastify.log.info(`[Config] Loaded ${scoreThresholds.length} score thresholds from Redis`);
        }
    } catch (err) {
        fastify.log.error(`[Config] Failed to load score thresholds: ${err.message}`);
    }
};

/**
 * Session Score Accumulation
 * Tracks cumulative SCORE vectors per session
 */
const getOrCreateSessionScore = (sessionId) => {
    if (!sessionScores.has(sessionId)) {
        sessionScores.set(sessionId, {
            sessionId,
            vectors: { S: 0, C: 0, O: 0, R: 0, E: 0 },
            lastUpdate: Date.now(),
            eventCount: 0,
            triggeredThresholds: new Set(), // Track which thresholds have fired
        });
    }
    return sessionScores.get(sessionId);
};

const accumulateScore = (sessionId, vector, weight) => {
    const session = getOrCreateSessionScore(sessionId);
    if (vector && session.vectors.hasOwnProperty(vector)) {
        session.vectors[vector] += weight;
        session.eventCount++;
        session.lastUpdate = Date.now();
    }
    return session;
};

/**
 * Evaluate score thresholds and return any triggered actions
 */
const evaluateThresholds = (sessionId, sessionData) => {
    const triggeredActions = [];

    for (const threshold of scoreThresholds) {
        if (threshold.enabled === false) continue;

        const vector = threshold.vector;
        const currentScore = sessionData.vectors[vector] || 0;
        const thresholdValue = threshold.thresholdValue || threshold.threshold_value;
        const operator = threshold.operator;

        // Check if threshold was already triggered (cooldown)
        const thresholdKey = `${threshold.id}`;
        if (sessionData.triggeredThresholds.has(thresholdKey)) continue;

        let triggered = false;
        switch (operator) {
            case '>': triggered = currentScore > thresholdValue; break;
            case '>=': triggered = currentScore >= thresholdValue; break;
            case '<': triggered = currentScore < thresholdValue; break;
            case '<=': triggered = currentScore <= thresholdValue; break;
            case '=': triggered = currentScore === thresholdValue; break;
        }

        if (triggered && threshold.triggeredAction) {
            triggeredActions.push({
                thresholdId: threshold.id,
                thresholdName: threshold.name,
                action: threshold.triggeredAction,
                vector,
                currentScore,
                thresholdValue
            });

            // Mark as triggered to prevent repeat firing
            sessionData.triggeredThresholds.add(thresholdKey);
        }
    }

    return triggeredActions;
};

// Clean up old sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, data] of sessionScores.entries()) {
        if (now - data.lastUpdate > SESSION_TTL_MS) {
            sessionScores.delete(sessionId);
            fastify.log.info(`[Session] Cleaned up expired session: ${sessionId}`);
        }
    }
}, 5 * 60 * 1000); // Every 5 minutes

/**
 * Hierarchical Scoring Engine
 * Matches rules based on 6-level hierarchy: Page → PageState → Card → ElementType → ElementId → Activity
 * More specific rules take precedence (higher specificity score)
 */
const matchHierarchicalRules = (pulse, rules) => {
    const { r_path, act_id, ctx = {} } = pulse;

    // Extract context from pulse
    const pulseContext = {
        page: r_path,
        pageState: ctx.page_state || ctx.state || '',
        card: ctx.card_type || ctx.card_label || '',
        elementType: ctx.element_type || ctx.input_type || '',
        elementId: ctx.element_id || ctx.target_id || act_id || '',
        activity: pulse.type || ctx.activity || act_id || ''
    };

    const matchedRules = [];

    for (const rule of rules) {
        // Skip disabled rules
        if (rule.enabled === false) continue;

        // Activity is required - must match
        if (!rule.activity || !pulseContext.activity) continue;
        if (!activityMatches(rule.activity, pulseContext.activity)) continue;

        // Check hierarchy levels (optional - empty means "any")
        let specificity = 0;
        let matches = true;

        // Level 1: Page
        if (rule.page && rule.page.trim() !== '') {
            if (!pageMatches(rule.page, pulseContext.page)) {
                matches = false;
            } else {
                specificity += 32; // Highest bit
            }
        }

        // Level 2: Page State
        if (matches && rule.pageState && rule.pageState.trim() !== '') {
            if (rule.pageState.toLowerCase() !== pulseContext.pageState.toLowerCase()) {
                matches = false;
            } else {
                specificity += 16;
            }
        }

        // Level 3: Card
        if (matches && rule.card && rule.card.trim() !== '') {
            if (!pulseContext.card || rule.card.toLowerCase() !== pulseContext.card.toLowerCase()) {
                matches = false;
            } else {
                specificity += 8;
            }
        }

        // Level 4: Element Type
        if (matches && rule.elementType && rule.elementType.trim() !== '') {
            if (!pulseContext.elementType || rule.elementType.toLowerCase() !== pulseContext.elementType.toLowerCase()) {
                matches = false;
            } else {
                specificity += 4;
            }
        }

        // Level 5: Element ID
        if (matches && rule.elementId && rule.elementId.trim() !== '') {
            if (!pulseContext.elementId || !pulseContext.elementId.includes(rule.elementId.replace('#', ''))) {
                matches = false;
            } else {
                specificity += 2;
            }
        }

        // Activity already matched, add base specificity
        if (matches) {
            specificity += 1;
            matchedRules.push({ rule, specificity });
        }
    }

    // Sort by specificity (highest first) then by priority
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    matchedRules.sort((a, b) => {
        if (b.specificity !== a.specificity) return b.specificity - a.specificity;
        return (priorityOrder[b.rule.priority] || 0) - (priorityOrder[a.rule.priority] || 0);
    });

    return matchedRules;
};

/**
 * Check if page matches (supports pattern matching like /jobs/:id)
 */
const pageMatches = (rulePattern, actualPath) => {
    if (!actualPath) return false;

    // Exact match
    if (rulePattern === actualPath) return true;

    // Pattern with :id placeholder
    if (rulePattern.includes(':')) {
        const regex = new RegExp('^' + rulePattern.replace(/:\w+/g, '[^/]+') + '$');
        return regex.test(actualPath);
    }

    // Wildcard pattern
    if (rulePattern.endsWith('*')) {
        return actualPath.startsWith(rulePattern.slice(0, -1));
    }

    return false;
};

/**
 * Check if activity matches (exact or category match)
 */
const activityMatches = (ruleActivity, pulseActivity) => {
    if (!pulseActivity) return false;

    // Exact match
    if (ruleActivity.toLowerCase() === pulseActivity.toLowerCase()) return true;

    // Map common activities
    const activityMappings = {
        'click': ['click', 'cta_click', 'button_click', 'nav_click'],
        'input_change': ['input_change', 'field_entry', 'change'],
        'page_view': ['page_view', 'view', 'load'],
        'hover': ['hover', 'hover_2s', 'hover_5s'],
        'focus': ['focus', 'input_focus', 'field_focus']
    };

    for (const [category, activities] of Object.entries(activityMappings)) {
        if (ruleActivity.toLowerCase() === category && activities.includes(pulseActivity.toLowerCase())) {
            return true;
        }
        if (activities.includes(ruleActivity.toLowerCase()) && activities.includes(pulseActivity.toLowerCase())) {
            return true;
        }
    }

    return false;
};


// --- RabbitMQ Connection ---
const connectRabbit = async () => {
    try {
        const conn = await amqp.connect(RABBIT_URL);
        channel = await conn.createChannel();
        await channel.assertQueue(QUEUE_NAME, {
            durable: false,
            messageTtl: 60000
        });
        fastify.log.info('[RabbitMQ] Connected and Queue Asserted');
    } catch (err) {
        fastify.log.error(`[RabbitMQ] Connection failed: ${err.message}`);
        setTimeout(connectRabbit, 5000);
    }
};

// --- CORS ---
// --- CORS ---
// Removed duplicate registration


/**
 * Enhanced Semantic Lookup Logic
 * Resolves intent from route, action, section, card, and button context.
 */
const resolveIntent = (pulse) => {
    const { r_path, r_desc, act_id, vel = 0, ctx = {} } = pulse;

    let vector = null;
    let label = "Unknown";
    let intensity = 1.0;
    let priority = "low";
    let nlpContext = [];

    // --- 0. HIERARCHICAL RULE MATCHING (New System) ---
    // Use hierarchical specificity-based matching for new schema rules
    const hierarchicalMatches = matchHierarchicalRules(pulse, dynamicRules);

    if (hierarchicalMatches.length > 0) {
        // Apply the most specific matching rule
        const bestMatch = hierarchicalMatches[0];
        const rule = bestMatch.rule;

        vector = rule.vector;
        intensity = rule.weight || 1.0;
        priority = rule.priority || 'low';

        // Apply activity modifier if present
        if (rule.activityModifier && rule.activityModifier !== 1.0) {
            intensity *= rule.activityModifier;
        }

        // Store triggered action for later execution
        if (rule.triggeredAction) {
            // This will be processed by the action executor
            pulse._triggeredAction = rule.triggeredAction;
            pulse._matchedRule = { id: rule.id, name: rule.name, specificity: bestMatch.specificity };
        }

        nlpContext.push(`matched rule "${rule.name || 'Rule #' + rule.id}"`);

        // If critical priority, don't continue with fallback matching
        if (rule.priority === 'critical') {
            return {
                vector,
                label: rule.name || label,
                intensity,
                priority,
                nlpDescription: nlpContext.join(', '),
                triggeredAction: rule.triggeredAction
            };
        }
    }

    // --- LEGACY: Fall back to old matchType-based rules for backwards compatibility ---
    for (const rule of dynamicRules) {
        // Skip new-schema rules (they have 'activity' field)
        if (rule.activity) continue;

        let matched = false;

        if (rule.matchType === 'route') {
            if (r_path === rule.matchValue) matched = true;
        } else if (rule.matchType === 'action_id') {
            if (act_id === rule.matchValue) {
                if (rule.routeFilter && rule.routeFilter !== r_path) {
                    matched = false;
                } else {
                    matched = true;
                }
            }
        } else if (rule.matchType === 'card') {
            if (ctx.card_type === rule.matchValue || ctx.card_label === rule.matchValue) matched = true;
        } else if (rule.matchType === 'field') {
            if (ctx.input_name === rule.matchValue) matched = true;
        } else if (rule.matchType === 'hover') {
            if (act_id === 'hover' && (ctx.hover_target_id === rule.matchValue || ctx.element_label === rule.matchValue)) matched = true;
        }

        // --- Layered conditions check ---
        if (matched && rule.conditions && Array.isArray(rule.conditions)) {
            for (const cond of rule.conditions) {
                if (cond.type === 'route') {
                    if (cond.value !== r_path) { matched = false; break; }
                } else if (cond.type === 'card') {
                    if (ctx.card_type !== cond.value && ctx.card_label !== cond.value) { matched = false; break; }
                } else if (cond.type === 'field') {
                    if (ctx.input_name !== cond.value) { matched = false; break; }
                }
            }
        }

        if (matched) {
            vector = rule.vector;
            intensity = rule.weight;
            priority = rule.priority;
            if (rule.priority === 'critical') break;
        }
    }

    // 1. Route-Level Intent (Base context)
    const routeMatch = matchRoute(r_path);
    if (routeMatch) {
        vector = routeMatch.vector;
        label = routeMatch.label;
        intensity = routeMatch.weight || 1.0;
        if (routeMatch.nlp_context) {
            nlpContext.push(routeMatch.nlp_context);
        }
    }

    // 2. Section Context (sidebar, modal, main, etc.)
    if (ctx.section && intentMap.sections && intentMap.sections[ctx.section]) {
        const sectionConfig = intentMap.sections[ctx.section];
        // Section can influence but not override route vector
        intensity *= (sectionConfig.weight || 1.0);
        if (sectionConfig.nlp_context) {
            nlpContext.push(sectionConfig.nlp_context);
        }
    }

    // 3. Card Context (job-card, alert-card, etc.)
    if (ctx.card_type && intentMap.cards && intentMap.cards[ctx.card_type]) {
        const cardConfig = intentMap.cards[ctx.card_type];
        // Cards can override vector if more specific
        vector = cardConfig.vector;
        intensity *= (cardConfig.weight || 1.0);
        if (cardConfig.nlp_context) {
            nlpContext.push(cardConfig.nlp_context);
        }
        if (ctx.card_label) {
            nlpContext.push(`titled '${ctx.card_label}'`);
        }
    }

    // 4. Button Intent Context (destructive, primary, etc.)
    if (ctx.button_intent && intentMap.button_intents && intentMap.button_intents[ctx.button_intent]) {
        const btnConfig = intentMap.button_intents[ctx.button_intent];
        vector = btnConfig.vector;
        intensity *= (btnConfig.weight || 1.0);
        if (btnConfig.nlp_context) {
            nlpContext.push(btnConfig.nlp_context);
        }
    }

    // 5. Action-Level Intent (Strongest override)
    if (act_id && intentMap.actions[act_id]) {
        const actionConfig = intentMap.actions[act_id];
        vector = actionConfig.vector;
        priority = actionConfig.priority || "low";
        intensity *= intentMap.global_config.intensity_multiplier;
        if (actionConfig.nlp_context) {
            nlpContext.push(actionConfig.nlp_context);
        }
    }

    // 6. Input Type Context
    if (ctx.input_type && intentMap.input_types && intentMap.input_types[ctx.input_type]) {
        const inputConfig = intentMap.input_types[ctx.input_type];
        if (inputConfig.nlp_context) {
            nlpContext.push(inputConfig.nlp_context);
        }
    }

    // 7. Modal/Drawer Context
    if (ctx.is_modal && ctx.modal_title) {
        nlpContext.push(`in the '${ctx.modal_title}' dialog`);
    }

    // 8. Element Label Context
    if (ctx.element_label) {
        nlpContext.push(`clicking '${ctx.element_label}'`);
    }

    // 9. Data Context (job IDs, pipeline IDs, etc.)
    if (ctx.job_id) {
        nlpContext.push(`on Job #${ctx.job_id}`);
    }
    if (ctx.pipeline_id) {
        nlpContext.push(`on Pipeline #${ctx.pipeline_id}`);
    }
    if (ctx.alert_id) {
        nlpContext.push(`for Alert #${ctx.alert_id}`);
    }

    // 10. Tab Context
    if (ctx.tab_name) {
        nlpContext.push(`in the '${ctx.tab_name}' tab`);
    }

    // 11. Somatic Scaling (Velocity)
    if (vel > 100) intensity *= 1.5;
    if (vel > 200) {
        nlpContext.push('with agitated mouse movement');
    }

    // 12. Idle Context
    if (ctx.idle_context) {
        nlpContext.push('after becoming idle');
    }

    // Build human-readable NLP description
    const nlpDescription = nlpContext.length > 0
        ? nlpContext.join(', ')
        : (r_desc || r_path);

    return { vector, label, intensity, priority, nlpDescription };
};

/**
 * Match dynamic routes like /jobs/:id
 */
const matchRoute = (path) => {
    // Exact match first
    if (intentMap.routes[path]) {
        return intentMap.routes[path];
    }

    // Dynamic route matching
    for (const [pattern, config] of Object.entries(intentMap.routes)) {
        if (pattern.includes(':')) {
            const regex = new RegExp('^' + pattern.replace(/:\w+/g, '\\d+') + '$');
            if (regex.test(path)) {
                return config;
            }
        }
    }

    return null;
};

// --- Routes ---
fastify.get('/health', async () => ({ status: 'ok', service: 'ingestor', version: intentMap.version }));

fastify.post('/pulse', async (request, reply) => {
    if (!channel) {
        return reply.code(503).send({ error: 'Upstream buffer unavailable' });
    }

    // 1. Parse Pulse
    const pulse = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;

    // 2. Resolve Enhanced Semantic Intent
    const semanticData = resolveIntent(pulse);

    // 3. Default to 'S' (Symptom) if unknown but high velocity
    if (!semanticData.vector && pulse.vel > 200) {
        semanticData.vector = 'S';
        semanticData.label = 'High Velocity Jitter';
        semanticData.nlpDescription = 'frustrated mouse movement without clear intent';
    }

    // 4. Accumulate session score
    const sessionId = pulse.session_id || pulse.ctx?.session_id || 'anonymous';
    let sessionData = null;
    let thresholdActions = [];

    if (semanticData.vector && sessionId !== 'anonymous') {
        sessionData = accumulateScore(sessionId, semanticData.vector, semanticData.intensity || 1);

        // 5. Check score thresholds
        thresholdActions = evaluateThresholds(sessionId, sessionData);
    }

    // 6. Construct Enhanced Payload
    const message = {
        ...pulse,
        ...semanticData,
        ingest_ts: Date.now(),
        session_scores: sessionData ? sessionData.vectors : null,
        threshold_actions: thresholdActions.length > 0 ? thresholdActions : undefined,
        rule_action: pulse._triggeredAction || semanticData.triggeredAction || undefined,
        matched_rule: pulse._matchedRule || undefined
    };

    // 7. Fire to RabbitMQ
    const buffer = Buffer.from(JSON.stringify(message));
    channel.sendToQueue(QUEUE_NAME, buffer);

    // 8. Analytics Logging (Async)
    (async () => {
        try {
            // Log Rule Match
            if (message.rule_action) {
                await pool.query(
                    `INSERT INTO psychologist_events 
                    (session_id, event_type, rule_id, action_type, action_config, vector_state, confidence, location) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        sessionId,
                        'rule_match',
                        message.matched_rule?.id || null,
                        message.rule_action.type,
                        message.rule_action.config,
                        JSON.stringify(sessionData?.vectors || {}),
                        semanticData.intensity,
                        pulse.url || pulse.ctx?.path || 'unknown'
                    ]
                );
            }

            // Log Threshold Triggers
            for (const tAction of thresholdActions) {
                await pool.query(
                    `INSERT INTO psychologist_events 
                    (session_id, event_type, threshold_id, action_type, action_config, vector_state, location) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        sessionId,
                        'threshold_trigger',
                        tAction.thresholdId,
                        tAction.action.type,
                        tAction.action.config,
                        JSON.stringify(sessionData?.vectors || {}),
                        pulse.url || pulse.ctx?.path || 'unknown'
                    ]
                );
            }
        } catch (err) {
            fastify.log.error(`[Analytics] Failed to log event: ${err.message}`);
        }
    })();

    // Return response with any triggered actions for client-side handling
    return {
        status: 'acked',
        triggered_actions: [...(thresholdActions.length > 0 ? thresholdActions : []),
        ...(message.rule_action ? [{ action: message.rule_action }] : [])]
    };
});

/**
 * Session Scoring Context API
 * Exposes real-time session scores for concierge integration
 */
fastify.get('/session/:sessionId/scoring-context', async (request, reply) => {
    const { sessionId } = request.params;

    if (!sessionScores.has(sessionId)) {
        return reply.code(404).send({ error: 'Session not found' });
    }

    const session = sessionScores.get(sessionId);
    const vectors = session.vectors;

    // Find dominant vector
    let dominantVector = 'S';
    let maxScore = 0;
    for (const [vector, score] of Object.entries(vectors)) {
        if (score > maxScore) {
            maxScore = score;
            dominantVector = vector;
        }
    }

    // Calculate confidence (how much the dominant vector stands out)
    const totalScore = Object.values(vectors).reduce((a, b) => a + Math.abs(b), 0);
    const confidence = totalScore > 0 ? (maxScore / totalScore) : 0;

    return {
        sessionId,
        vectors,
        dominantVector,
        confidence: Math.round(confidence * 100) / 100,
        eventCount: session.eventCount,
        lastUpdate: session.lastUpdate,
        triggeredThresholds: Array.from(session.triggeredThresholds)
    };
});

// Get all active sessions (for admin/debugging)
fastify.get('/sessions', async (request, reply) => {
    const sessions = [];
    for (const [sessionId, data] of sessionScores.entries()) {
        sessions.push({
            sessionId,
            eventCount: data.eventCount,
            vectors: data.vectors,
            lastUpdate: data.lastUpdate
        });
    }
    return { count: sessions.length, sessions };
});


// --- Start ---
const start = async () => {
    await connectRabbit();
    await connectRedis();
    try {
        await fastify.listen({ port: 3001, host: '0.0.0.0' });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
