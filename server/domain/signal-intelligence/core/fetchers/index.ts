/**
 * Built-in feed fetchers.
 *
 * Registration is explicit and idempotent. Any process that polls feeds must
 * call `registerBuiltInFetchers()` before it does — an unregistered source type
 * silently falls back to the generic HTTP fetcher, which is precisely the
 * failure this registry exists to prevent.
 */

import { createLogger } from "@server/utils/logger.js";
import { registerFeedFetcher } from "../signal-ingestion.service.js";
import { redditFetcher } from "./reddit-fetcher.js";
import { saasAdapterFetcher } from "./saas-adapter-fetcher.js";

const logger = createLogger("FeedFetchers");

let registered = false;

export function registerBuiltInFetchers(): void {
  if (registered) return;
  registered = true;

  registerFeedFetcher("reddit", redditFetcher);
  registerFeedFetcher("saas_adapter", saasAdapterFetcher);

  logger.info("Built-in feed fetchers registered.");
}

export { redditFetcher, saasAdapterFetcher };

