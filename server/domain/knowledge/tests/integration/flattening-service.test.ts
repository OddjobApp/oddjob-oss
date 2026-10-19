
import { describe, it, expect } from 'vitest';
import { extractFields, applyHygiene, DataHygiene } from "@domain/knowledge/core/flattening-service.js";

describe('Flattening Service - extractFields', () => {
    const sampleData = {
        user: {
            id: 1,
            profile: {
                name: "Alice",
                age: 30
            },
            tags: ["admin", "staff"]
        },
        meta: {
            created: "2024-01-01"
        }
    };

    it('should extract simple nested fields', () => {
        const columns = [
            { jsonPath: "user.id", datasetKey: "user_id", type: "number" as const },
            { jsonPath: "user.profile.name", datasetKey: "user_name", type: "text" as const }
        ];
        const result = extractFields(sampleData, columns);
        expect(result).toEqual({
            user_id: 1,
            user_name: "Alice"
        });
    });

    it('should extract intermediate objects as JSON', () => {
        const columns = [
            { jsonPath: "user.profile", datasetKey: "profile_json", type: "json" as const }
        ];
        const result = extractFields(sampleData, columns);
        // coerceValue for 'json' returns the object itself (not stringified)
        expect(typeof result.profile_json).toBe('object');
        expect(result.profile_json).toEqual({ name: "Alice", age: 30 });
    });

    it('should handle missing paths gracefully', () => {
        const columns = [
            { jsonPath: "user.missing.field", datasetKey: "missing", type: "text" as const }
        ];
        const result = extractFields(sampleData, columns);
        expect(result.missing).toBe(null);
    });
});

describe('Flattening Service - applyHygiene', () => {
    const rows = [
        { id: 1, name: "Alice", role: null },
        { id: 2, name: "Bob", role: "admin" },
        { id: 1, name: "Alice", role: "user" }, // Duplicate by ID
        { id: 3, name: "Charlie", role: null }
    ];

    it('should remove nulls (drop strategy)', () => {
        const hygiene: DataHygiene = {
            nullHandling: { strategy: 'drop' }
        };
        const { rows: result } = applyHygiene(rows, hygiene);
        expect(result).toHaveLength(2); // Alice(dup) and Bob. Alice(1) and Charlie have nulls.
        // Wait, row 2 (Alice duplicate) has role="user", so it is NOT null.
        // Row 1 has role=null. Row 4 has role=null.
        // Expect: Row 2 (Bob) and Row 3 (Alice-dup).
        expect(result.map(r => r.name)).toEqual(['Bob', 'Alice']);
    });

    it('should fill nulls (fill strategy)', () => {
        const hygiene: DataHygiene = {
            nullHandling: { strategy: 'fill', fillValue: 'N/A' }
        };
        const { rows: result } = applyHygiene(rows, hygiene);
        expect(result).toHaveLength(4);
        expect(result[0].role).toBe('N/A');
        expect(result[3].role).toBe('N/A');
    });

    it('should deduplicate keeping first', () => {
        const hygiene: DataHygiene = {
            deduplication: { enabled: true, strategy: 'keepFirst', keyColumns: ['id'] }
        };
        // We only pass rows with id 1, 2, 1, 3
        const { rows: result } = applyHygiene(rows, hygiene);
        expect(result.map(r => r.id)).toEqual([1, 2, 3]);
        // The first Alice (id=1) had role=null. 
        expect(result.find(r => r.id === 1)?.role).toBeNull();
    });

    it('should deduplicate keeping last', () => {
        const hygiene: DataHygiene = {
            deduplication: { enabled: true, strategy: 'keepLast', keyColumns: ['id'] }
        };
        const { rows: result } = applyHygiene(rows, hygiene);
        expect(result.map(r => r.id)).toEqual([2, 1, 3]); // Order might vary depending on impl, usually preserves original relative order of survivors
        // or it might reorder.
        // Implementation: reverse -> dedupe -> reverse.
        // [1a, 2, 1b, 3] -> reverse -> [3, 1b, 2, 1a]
        // seen {3, 1, 2}. unique [3, 1b, 2]
        // reverse -> [2, 1b, 3].

        const alice = result.find(r => r.id === 1);
        expect(alice?.role).toBe("user"); // The second occurrence
    });

    it('should apply both hygiene rules', () => {
        // Drop nulls THEN dedupe? or Dedupe then Drop? 
        // My implementation in `applyHygiene` does Null Handling first, then Deduplication.

        const hygiene: DataHygiene = {
            nullHandling: { strategy: 'drop' },
            deduplication: { enabled: true, strategy: 'keepFirst', keyColumns: ['id'] }
        };

        // 1. Drop nulls:
        // Row 1 (Alice, null) -> Dropped
        // Row 2 (Bob, admin) -> Keep
        // Row 3 (Alice, user) -> Keep
        // Row 4 (Charlie, null) -> Dropped
        // Intermediate: [Bob, Alice(1, user)]

        // 2. Dedupe (keepFirst):
        // Bob (id 2) -> Keep
        // Alice (id 1) -> Keep

        const { rows: result } = applyHygiene(rows, hygiene);
        expect(result).toHaveLength(2);
        expect(result.find(r => r.name === 'Alice')?.role).toBe("user");
    });
});
