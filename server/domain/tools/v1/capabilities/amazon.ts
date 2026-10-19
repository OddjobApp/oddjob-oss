import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { ToolContext, ToolDefinition } from './types.js';
import { resolveAmazonProvider, type ResolvedAmazon } from '@domain/integrations/amazon/resolver.js';
import { buildCartUrl, buildProductUrl, isAsin, normalizeMarketplace, parseCartUrl } from '@domain/integrations/amazon/cart-link.js';
import type { AmazonProduct } from '@domain/integrations/amazon/types.js';
import { isAmazonUrl } from '@shared/amazon-links.js';

/**
 * Amazon shopping — discovery plus cart handoff. There is deliberately no path
 * that automates a user's Amazon session: Amazon has no checkout API and has
 * enjoined that pattern elsewhere. An agent finds and compares products, then
 * hands a human an Associates cart link (or an approval-gated procurement
 * proposal) to complete in their own browser.
 */

const asinSchema = z.string().regex(/^[A-Z0-9]{10}$/i, 'An ASIN is 10 letters/digits');

const SHOPPING_GUARDRAILS = [
    'Uses the organization’s configured provider first; shared Rainforest/SerpApi credentials may provide catalog data. Never uses a platform Associates tag.',
    'The agent never logs in to or automates amazon.com; results are catalog data from the configured provider.',
    'Prices and availability are indicative — the live price is shown on the Amazon page the person opens.',
    'A purchase is completed by a human in their own browser via a cart handoff link.',
];

async function amazon(context: ToolContext): Promise<ResolvedAmazon> {
    if (context.organizationId == null) throw new Error('Amazon product lookup needs an organization context.');
    const resolved = await resolveAmazonProvider(context.organizationId);
    if (!resolved) {
        throw new Error('Amazon product lookup is not configured for this organization. Add an Amazon Creators API credential or a Rainforest/SerpApi key in Connections → Credentials (metadata provider: amazon_creators, amazon_rainforest or amazon_serpapi), or use connect_platform with platform amazon.');
    }
    return resolved;
}

/** Optional provider: cart building works tagless even when unconfigured. */
async function maybeAmazon(context: ToolContext): Promise<{ resolved: ResolvedAmazon | null; warning?: string }> {
    if (context.organizationId == null) return { resolved: null };
    try {
        return { resolved: await resolveAmazonProvider(context.organizationId) };
    } catch (err: any) {
        return { resolved: null, warning: err?.message ?? String(err) };
    }
}

/** Canonical affiliate-tagged detail link; keeps a provider's tagged link. */
function taggedUrl(product: AmazonProduct, tag: string | undefined, marketplace: string): string {
    if (isAmazonUrl(product.url) && normalizeMarketplace(new URL(product.url).hostname) === marketplace) {
        if (tag && !/[?&]tag=/.test(product.url)) return buildProductUrl(marketplace, product.asin, tag);
        return product.url;
    }
    return buildProductUrl(marketplace, product.asin, tag);
}

function presentable(product: AmazonProduct, resolved: ResolvedAmazon | null, requestedMarketplace?: string) {
    const marketplace = normalizeMarketplace(requestedMarketplace ?? resolved?.marketplace);
    const tag = resolved?.partnerTag;
    return {
        ...product,
        url: taggedUrl(product, tag, marketplace),
        cartUrl: buildCartUrl(marketplace, tag, [{ asin: product.asin, quantity: 1 }]),
    };
}

const cartItemSchema = z.object({ asin: asinSchema, quantity: z.number().int().min(1).max(999).default(1) });
const purchaseSchema = z.object({
    marketplace: z.string().max(60).optional(),
    items: z.array(cartItemSchema).min(1).max(10),
    title: z.string().min(1).max(200).optional(),
    reason: z.string().max(1000).optional(),
    max_total: z.number().positive().optional().describe('Budget ceiling in the items’ currency; the proposal is refused and the approval fails if the priced total exceeds it'),
});

type PurchaseArgs = z.infer<typeof purchaseSchema>;

interface PriceCheck {
    byAsin: Map<string, AmazonProduct>;
    /** Numeric total when every line priced, else null. */
    total: number | null;
    currency: string;
    display: string | null;
}

function priceItems(items: PurchaseArgs['items'], priced: AmazonProduct[]): PriceCheck {
    const byAsin = new Map(priced.map(product => [product.asin.toUpperCase(), product]));
    const currency = priced[0]?.price?.currency || 'USD';
    if (!items.length || !items.every(item => {
        const price = byAsin.get(item.asin.toUpperCase())?.price;
        return price && Number.isFinite(price.amount) && price.amount > 0 && price.currency === currency;
    })) {
        return { byAsin, total: null, currency, display: null };
    }
    const total = Math.round(items.reduce((sum, item) => sum + (byAsin.get(item.asin.toUpperCase())!.price!.amount * item.quantity), 0) * 100) / 100;
    let display: string;
    try { display = new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(total); }
    catch { display = `${total.toFixed(2)} ${currency}`; }
    return { byAsin, total, currency, display };
}

function argItems(items: PurchaseArgs['items'], check: PriceCheck) {
    return items.map(item => {
        const product = check.byAsin.get(item.asin.toUpperCase());
        return {
            asin: item.asin.toUpperCase(),
            quantity: item.quantity,
            title: product?.title,
            price_display: product?.price?.display,
            line_total: product?.price ? Math.round(product.price.amount * item.quantity * 100) / 100 : undefined,
        };
    });
}

/** Structured cart items back out of persisted proposal args. */
function recoverItems(args: { items?: unknown; cart_url?: unknown }): PurchaseArgs['items'] {
    const raw = Array.isArray(args.items) ? args.items : [];
    const items = raw.map((entry: any) => {
        if (entry && typeof entry === 'object' && isAsin(entry.asin)) {
            return { asin: entry.asin.toUpperCase(), quantity: Math.min(Math.max(Math.trunc(Number(entry.quantity)) || 1, 1), 999) };
        }
        return null;
    }).filter((item): item is { asin: string; quantity: number } => item !== null);
    if (items.length) return items;
    const fromUrl = parseCartUrl(args.cart_url);
    if (fromUrl.length) return fromUrl;
    throw new Error('This purchase proposal has no readable items to hand off.');
}

/**
 * Called only by the authenticated approval service, on persisted proposal
 * arguments. Re-fetches live prices (the proposal's numbers can be stale),
 * enforces the proposal's budget, and returns a fresh cart link for the
 * approver's own browser — the platform never holds Amazon credentials or
 * completes checkout.
 */
export async function executeAmazonPurchaseApproval(action: string, args: unknown, context: ToolContext) {
    if (action !== 'amazon_checkout') throw new Error('Unsupported Amazon action.');
    const parsed = (args ?? {}) as { items?: unknown; cart_url?: unknown; marketplace?: unknown; max_total?: unknown; currency?: unknown };
    const items = recoverItems(parsed);
    const maxTotal = typeof parsed.max_total === 'number' && parsed.max_total > 0 ? parsed.max_total : undefined;
    const { resolved } = await maybeAmazon(context);
    const marketplace = normalizeMarketplace(typeof parsed.marketplace === 'string' ? parsed.marketplace : resolved?.marketplace);

    let priced: AmazonProduct[] = [];
    if (resolved) {
        try { priced = await resolved.provider.getItems(items.map(item => item.asin), marketplace); } catch { /* unpriced handoff is still valid */ }
    }
    const check = priceItems(items, priced);
    if (maxTotal != null && check.total == null) throw new Error('Cannot verify the approved budget: every item needs a valid price in the same currency. Reconnect the provider or request a fresh review.');
    if (maxTotal != null && parsed.currency && check.currency !== parsed.currency) throw new Error('The currency changed since this proposal. A fresh review is required.');
    if (maxTotal != null && check.total != null && check.total > maxTotal) {
        throw new Error(`Re-priced total ${check.display ?? check.total} exceeds the approved max_total of ${maxTotal} — the proposal needs a fresh review.`);
    }
    const checkoutUrl = buildCartUrl(marketplace, resolved?.partnerTag, items);
    return {
        checkoutUrl,
        items: items.map(item => {
            const product = check.byAsin.get(item.asin.toUpperCase());
            return {
                asin: item.asin.toUpperCase(),
                quantity: item.quantity,
                title: product?.title,
                price: product?.price?.display,
                lineTotal: product?.price ? Math.round(product.price.amount * item.quantity * 100) / 100 : undefined,
                livePriceChecked: !!product?.price && Number.isFinite(product.price.amount) && product.price.amount > 0,
            };
        }),
        estimatedTotal: check.display,
        marketplace,
        handoff: 'approver_browser',
        note: 'Prices re-checked at approval time where possible; the final price is shown on the Amazon cart page. A person completes checkout in their own browser.',
    };
}

async function proposePurchase(args: unknown, context: ToolContext) {
    const p = purchaseSchema.parse(args);
    if (context.organizationId == null) throw new Error('Organization context is required.');

    // Best-effort pre-pricing — the approver's executor re-prices anyway.
    const { resolved, warning } = await maybeAmazon(context);
    const marketplace = normalizeMarketplace(p.marketplace ?? resolved?.marketplace);
    let priced: AmazonProduct[] = [];
    if (resolved) {
        try { priced = await resolved.provider.getItems(p.items.map(item => item.asin), marketplace); } catch { /* Budgeted proposals fail below when unpriced. */ }
    }
    const check = priceItems(p.items, priced);
    if (p.max_total != null && check.total == null) throw new Error('Cannot verify max_total: every item needs a valid price in the same currency.');
    if (p.max_total != null && check.total != null && check.total > p.max_total) {
        throw new Error(`Estimated total ${check.display} exceeds max_total of ${p.max_total} — narrow the items or raise the budget before proposing.`);
    }
    const cartUrl = buildCartUrl(marketplace, resolved?.partnerTag, p.items);

    const meta = {
        type: 'approval_request',
        kind: 'amazon_purchase',
        actionName: 'amazon_checkout',
        args: {
            items: argItems(p.items, check),
            estimated_total: check.display,
            cart_url: cartUrl,
            marketplace,
            currency: check.currency,
            ...(p.max_total != null ? { max_total: p.max_total } : {}),
        },
        title: p.title ?? 'Amazon purchase',
        reason: p.reason ?? 'Hand this cart to a person to complete on Amazon.',
        projectId: context.projectId ?? null,
        sessionKey: context.sessionKey ?? null,
        status: 'pending',
    };

    const { db } = await import('@server/database_service.js');
    const { approvalRequests } = await import('@shared/schema/index.js');
    const actor = String(context.userId ?? 'crew');
    const [row] = await db.insert(approvalRequests).values({
        executionId: `amazon_${randomBytes(16).toString('hex')}`,
        toolName: 'amazon_propose_purchase',
        toolArgs: meta,
        organizationId: context.organizationId,
        approverType: 'user',
        approverEmail: actor,
        ...(/^[0-9a-f-]{36}$/i.test(actor) ? { approverId: actor } : {}),
        token: randomBytes(24).toString('hex'),
        status: 'pending',
    }).returning({ id: approvalRequests.id });
    if (!row) throw new Error('The purchase proposal could not be saved.');
    return JSON.stringify({ ...meta, proposalId: row.id, ...(warning ? { warning } : {}), message: 'Pending approval; nothing has been ordered.' });
}

const read = (name: string, label: string, description: string, parameters: z.ZodTypeAny, execute: ToolDefinition['execute']): ToolDefinition => ({
    name, label, description, group: 'Amazon', idempotency: 'read-safe', riskLevel: 'low', guardrails: SHOPPING_GUARDRAILS, parameters, execute,
});

export const AMAZON_TOOLS: Record<string, ToolDefinition> = {
    amazon_search_products: read('amazon_search_products', 'Search Amazon products',
        'Search the Amazon catalog for products. Returns normalized items with price, availability and links — indicative data, not a live checkout quote. Use amazon_get_product for a closer look at one item.',
        z.object({
            query: z.string().min(1).max(300),
            category: z.string().max(100).optional().describe('Catalog category, e.g. Electronics — the provider’s search index'),
            min_price: z.number().min(0).optional().describe('Minimum price in major currency units, e.g. 24.99'),
            max_price: z.number().min(0).optional(),
            prime_only: z.boolean().default(false),
            brand: z.string().max(200).optional(),
            marketplace: z.string().max(60).optional().describe('Marketplace host such as www.amazon.co.uk; defaults to the credential’s'),
            page: z.number().int().min(1).max(10).default(1),
            page_token: z.string().optional().describe('Continuation token from a previous result card'),
            max_results: z.number().int().min(1).max(10).default(10),
        }),
        async (p, c) => {
            const resolved = await amazon(c);
            const page = p.page_token ? Math.min(Math.max(Number.parseInt(p.page_token, 10) || 1, 1), 10) : p.page;
            const result = await resolved.provider.searchItems({
                keywords: p.query,
                searchIndex: p.category,
                itemCount: p.max_results,
                itemPage: page,
                minPrice: p.min_price,
                maxPrice: p.max_price,
                brand: p.brand,
                primeOnly: p.prime_only,
                marketplace: p.marketplace,
            });
            return JSON.stringify({
                items: result.items.map(product => presentable(product, resolved, p.marketplace)),
                totalResults: result.totalResults ?? null,
                source: resolved.providerId,
                searchUrl: result.searchUrl ?? null,
                nextPageToken: result.nextPage != null ? String(result.nextPage) : null,
            });
        }),

    amazon_get_product: read('amazon_get_product', 'Read Amazon product',
        'Read one product by ASIN — price, availability, merchant, features and images. Read the actual item before recommending or proposing it.',
        z.object({
            asin: asinSchema,
            marketplace: z.string().max(60).optional(),
        }),
        async (p, c) => {
            const resolved = await amazon(c);
            const items = await resolved.provider.getItems([p.asin], p.marketplace);
            if (!items.length) throw new Error(`No Amazon product found for ASIN ${p.asin}.`);
            const item = presentable(items[0], resolved, p.marketplace);
            return JSON.stringify({ item, items: [item], source: resolved.providerId });
        }),

    amazon_get_variations: read('amazon_get_variations', 'List Amazon variations',
        'List a product’s variants (size, color, style) from its parent ASIN. Child ASINs are the purchasable items.',
        z.object({
            parent_asin: asinSchema,
            marketplace: z.string().max(60).optional(),
        }),
        async (p, c) => {
            const resolved = await amazon(c);
            const items = await resolved.provider.getVariations(p.parent_asin, p.marketplace);
            return JSON.stringify({ items: items.map(product => presentable(product, resolved, p.marketplace)), source: resolved.providerId });
        }),

    amazon_compare_products: read('amazon_compare_products', 'Compare Amazon products',
        'Compare up to 10 products by ASIN side by side. Returns each normalized product plus a best-by-price and best-by-rating pick where data exists.',
        z.object({
            asins: z.array(asinSchema).min(2).max(10),
            marketplace: z.string().max(60).optional(),
        }),
        async (p, c) => {
            const resolved = await amazon(c);
            const items = await resolved.provider.getItems(p.asins, p.marketplace);
            const withPrice = items.filter(product => product.price);
            const rated = items.filter(product => product.rating != null);
            return JSON.stringify({
                items: items.map(product => presentable(product, resolved, p.marketplace)),
                source: resolved.providerId,
                winner: {
                    byPrice: withPrice.length ? withPrice.reduce((best, product) => product.price!.amount < best.price!.amount ? product : best).asin : null,
                    byRating: rated.length ? rated.reduce((best, product) => product.rating! > best.rating! ? product : best).asin : null,
                },
            });
        }),

    amazon_build_cart: {
        name: 'amazon_build_cart',
        label: 'Build Amazon cart link',
        group: 'Amazon',
        idempotency: 'idempotent',
        riskLevel: 'low',
        guardrails: SHOPPING_GUARDRAILS,
        description: 'Build a cart handoff link for specific ASINs and quantities. Opening it in a browser adds the items to that person’s own Amazon cart for them to review and buy. Works without a configured credential (unattributed). Never implies a purchase was made.',
        parameters: z.object({
            items: z.array(cartItemSchema).min(1).max(10),
            marketplace: z.string().max(60).optional(),
        }),
        execute: async (p, c) => {
            const { resolved, warning } = await maybeAmazon(c);
            const marketplace = normalizeMarketplace(p.marketplace ?? resolved?.marketplace);
            const cartUrl = buildCartUrl(marketplace, resolved?.partnerTag, p.items);
            return JSON.stringify({
                cartUrl,
                marketplace,
                itemLinks: (p.items as z.infer<typeof cartItemSchema>[]).map(item => ({ asin: item.asin.toUpperCase(), quantity: item.quantity, url: buildProductUrl(marketplace, item.asin, resolved?.partnerTag) })),
                ...(warning ? { warning } : {}),
                instructions: 'Share this link with the person. Opening it adds the items to their own Amazon cart; they review and complete checkout themselves.',
            });
        },
    },

    amazon_propose_purchase: {
        name: 'amazon_propose_purchase',
        label: 'Propose Amazon purchase',
        group: 'Amazon',
        idempotency: 'none',
        riskLevel: 'low',
        approvalPolicy: { requiresApproval: false, rationale: 'This tool only saves a pending proposal. The authenticated approval service prepares the cart handoff.' },
        guardrails: [
            ...SHOPPING_GUARDRAILS,
            'Approval re-prices the cart live and re-checks the proposal’s max_total — an approver sees current prices, not the proposal’s snapshot.',
        ],
        description: 'Create an approval-gated procurement proposal for a set of ASINs. Nothing is bought: on approval, the approver gets a cart link that opens their own Amazon session. For personal shopping prefer amazon_build_cart, which needs no approval.',
        parameters: purchaseSchema,
        execute: proposePurchase,
    },
};
