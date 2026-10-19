export class WorkerPool<T, R> {
    constructor(
        private concurrency: number,
        private worker: (item: T) => Promise<R>
    ) {}
    
    async execute(items: T[]): Promise<R[]> {
        return this.executeWithProgress(items, () => {});
    }
    
    async executeWithProgress(
        items: T[],
        onProgress: (completed: number, total: number, item: T) => void
    ): Promise<R[]> {
        const results: R[] = new Array(items.length);
        let currentIndex = 0;
        let completedCount = 0;
        const total = items.length;
        
        const workerFn = async () => {
            while (currentIndex < items.length) {
                const index = currentIndex++;
                const item = items[index];
                
                try {
                    const result = await this.worker(item);
                    results[index] = result;
                } catch (error) {
                    throw error;
                } finally {
                    completedCount++;
                    onProgress(completedCount, total, item);
                }
            }
        };
        
        const workers = [];
        const actualConcurrency = Math.min(this.concurrency, items.length);
        
        for (let i = 0; i < actualConcurrency; i++) {
            workers.push(workerFn());
        }
        
        await Promise.all(workers);
        
        return results;
    }
}
