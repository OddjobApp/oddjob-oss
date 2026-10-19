# 🧩 Extract DOM Content

> **Capability ID:** `trycua_dom_extract`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Computer Use  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Extract structured text or element attributes from the active browser tab via the DevTools Protocol (CDP). Significantly faster and more accurate than screenshot OCR for data extraction tasks (search results, table rows, form values, structured page metadata). Only available on Oddjob-managed desktops (TRYCUA_PROVIDER_TYPE=org_desktop); falls back gracefully with an error if CDP is unavailable. Modes: 'text' — inner text of all elements matching the CSS selector; 'attribute' — value of a specific attribute (e.g. 'href', 'data-id'); 'full_page_text' — the entire visible text of the page (document.body.innerText); 'structured_json' — structured text, links, images, accessible labels and non-secret form values; 'table' — rows and cells from matching tables; 'url' — the active tab URL.

Extract structured text or element attributes from the active browser tab via the DevTools Protocol (CDP). Significantly faster and more accurate than screenshot OCR for data extraction tasks (search results, table rows, form values, structured page metadata). Only available on Oddjob-managed desktops (TRYCUA_PROVIDER_TYPE=org_desktop); falls back gracefully with an error if CDP is unavailable. Modes: 'text' — inner text of all elements matching the CSS selector; 'attribute' — value of a specific attribute (e.g. 'href', 'data-id'); 'full_page_text' — the entire visible text of the page (document.body.innerText); 'structured_json' — structured text, links, images, accessible labels and non-secret form values; 'table' — rows and cells from matching tables; 'url' — the active tab URL.

---

## Inputs

| Name | Type |
| --- | --- |
| `sessionId` | `string` |
| `mode` | `enum` |
| `selector` | `string` |
| `attribute` | `string` |
| `limit` | `number` |
| `tabUrl` | `string` |
| `ingestKnowledgeGraph` | `boolean` |

## Outputs

| Name | Type |
| --- | --- |
| `result` | `string` |

---

## Business Use Cases

_No business use cases documented._

---

## Security Guardrails

> [!NOTE]
> No explicit guardrails declared.
