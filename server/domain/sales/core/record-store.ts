/**
 * Sales reuses the generic, DB-free RecordStore abstraction that the finance
 * domain introduced — services depend ONLY on this interface so they unit-test
 * against the in-memory implementation, while executors inject the DB-backed
 * AppRecordsStore. The store is generic infra (it wraps `app_records`); it
 * happens to live under finance today. If a third domain needs it, hoist
 * record-store.ts to a shared location and update both re-exports.
 */
export { InMemoryRecordStore, DuplicateRecordError } from "../../finance/core/record-store.js";
export type { RecordStore } from "../../finance/core/record-store.js";

import type { FinanceRecord } from "../../finance/core/record-store.js";
/** A stored sales record: `{ recordId, data }`. */
export type SalesRecord<T = Record<string, any>> = FinanceRecord<T>;
