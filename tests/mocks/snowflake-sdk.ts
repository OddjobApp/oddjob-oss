export function createConnection() {
    return {
        connect: (cb: any) => cb(null),
        execute: (params: any) => {
            if (params.complete) params.complete(null, null, []);
        },
        destroy: (cb: any) => cb(null),
    };
}
