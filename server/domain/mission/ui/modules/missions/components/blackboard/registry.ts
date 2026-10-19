import type { ComponentType } from "react";
import type { ContentType, ClassificationResult } from "./classifier";

export interface RendererProps {
    label: string;
    displayLabel?: string;
    value: unknown;
    classification: ClassificationResult;
    missionId?: number | null;
    onLoadFull?: () => Promise<void>;
    isLoadingFull?: boolean;
}

import { MarkdownDocumentRenderer } from "./renderers/MarkdownDocumentRenderer";
import { CodeBlockRenderer } from "./renderers/CodeBlockRenderer";
import { SearchResultsRenderer } from "./renderers/SearchResultsRenderer";
import { ConversationThreadRenderer } from "./renderers/ConversationThreadRenderer";
import { StructuredDatasetRenderer } from "./renderers/StructuredDatasetRenderer";
import { TimelineEventsRenderer } from "./renderers/TimelineEventsRenderer";
import { UrlValueRenderer } from "./renderers/UrlValueRenderer";
import { ErrorObjectRenderer } from "./renderers/ErrorObjectRenderer";
import { KeyValueMapRenderer } from "./renderers/KeyValueMapRenderer";
import { StatusScalarRenderer } from "./renderers/StatusScalarRenderer";
import { EmptyValueRenderer } from "./renderers/EmptyValueRenderer";
import { BlackboardItemFallback } from "./renderers/BlackboardItemFallback";

const REGISTRY: Record<ContentType, ComponentType<RendererProps>> = {
    markdown_document:    MarkdownDocumentRenderer,
    code_block:           CodeBlockRenderer,
    search_results:       SearchResultsRenderer,
    conversation_thread:  ConversationThreadRenderer,
    structured_dataset:   StructuredDatasetRenderer,
    timeline_events:      TimelineEventsRenderer,
    url_value:            UrlValueRenderer,
    error_object:         ErrorObjectRenderer,
    key_value_map:        KeyValueMapRenderer,
    status_scalar:        StatusScalarRenderer,
    empty:                EmptyValueRenderer,
    json_tree:            BlackboardItemFallback,
};

export function getRenderer(type: ContentType): ComponentType<RendererProps> {
    return REGISTRY[type] ?? BlackboardItemFallback;
}
