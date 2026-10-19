/**
 * RecordStore — DB-free abstraction over a finance dataset collection.
 *
 * Finance "tables" are dataset collections that live in `app_records`
 * (keyed appId+orgId+collection+recordId). Services depend ONLY on this
 * interface so they can be unit-tested with the in-memory implementation
 * below; executors construct the DB-backed `AppRecordsStore` (separate
 * module so importing a service never pulls a database connection).
 */

export interface FinanceRecord<T = Record<string, any>> {
    recordId: string;
    data: T;
}

export class DuplicateRecordError extends Error {
    constructor(public collection: string, public recordId: string) {
        super(`Record already exists in '${collection}': ${recordId}`);
        this.name = "DuplicateRecordError";
    }
}

export interface RecordStore {
    list<T = Record<string, any>>(collection: string): Promise<FinanceRecord<T>[]>;
    get<T = Record<string, any>>(collection: string, recordId: string): Promise<FinanceRecord<T> | null>;
    /**
     * Insert or update a record. When `failIfExists` is set and a record with
     * the same id already exists, throws DuplicateRecordError (used for FITID
     * dedupe and immutable snapshots).
     */
    upsert<T = Record<string, any>>(
        collection: string,
        recordId: string,
        data: T,
        opts?: { failIfExists?: boolean },
    ): Promise<void>;
    delete(collection: string, recordId: string): Promise<void>;
}

/** In-memory RecordStore for tests and dry-runs. */
export class InMemoryRecordStore implements RecordStore {
    private store = new Map<string, Map<string, any>>();

    private bucket(collection: string): Map<string, any> {
        let b = this.store.get(collection);
        if (!b) {
            b = new Map();
            this.store.set(collection, b);
        }
        return b;
    }

    async list<T = Record<string, any>>(collection: string): Promise<FinanceRecord<T>[]> {
        return Array.from(this.bucket(collection).entries()).map(([recordId, data]) => ({
            recordId,
            data: structuredClone(data) as T,
        }));
    }

    async get<T = Record<string, any>>(collection: string, recordId: string): Promise<FinanceRecord<T> | null> {
        const b = this.bucket(collection);
        if (!b.has(recordId)) return null;
        return { recordId, data: structuredClone(b.get(recordId)) as T };
    }

    async upsert<T = Record<string, any>>(
        collection: string,
        recordId: string,
        data: T,
        opts?: { failIfExists?: boolean },
    ): Promise<void> {
        const b = this.bucket(collection);
        if (opts?.failIfExists && b.has(recordId)) {
            throw new DuplicateRecordError(collection, recordId);
        }
        b.set(recordId, structuredClone(data));
    }

    async delete(collection: string, recordId: string): Promise<void> {
        this.bucket(collection).delete(recordId);
    }
}
