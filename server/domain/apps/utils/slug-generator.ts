
export function generateSlug(base: string): string {
    const random = Math.floor(Math.random() * 1000000).toString(16);
    const cleaned = base.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `${cleaned}-${random}`;
}
