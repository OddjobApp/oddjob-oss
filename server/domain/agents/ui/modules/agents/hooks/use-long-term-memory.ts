
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useLongTermMemory(search?: string) {
    const queryClient = useQueryClient();

    const { data: memories, isLoading } = useQuery({
        queryKey: ["agent", "long-term-memories", search],
        queryFn: async () => {
            const url = new URL("/api/agent/long-term-memories", window.location.origin);
            if (search) url.searchParams.set("search", search);
            
            const res = await fetch(url.toString());
            if (!res.ok) throw new Error("Failed to fetch memories");
            return res.json();
        }
    });

    return {
        memories,
        isLoading
    };
}
