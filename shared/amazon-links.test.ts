import { describe, expect, it } from 'vitest';
import { isAmazonMarketplace, isAmazonUrl } from './amazon-links';
describe('Amazon link boundary', () => {
    it('accepts supported marketplaces and rejects look-alikes, credentials and alternate protocols', () => {
        expect(isAmazonMarketplace('www.amazon.co.uk')).toBe(true);
        expect(isAmazonUrl('https://www.amazon.com/dp/B08XYZ1234')).toBe(true);
        for (const url of ['https://www.amazon.evil.com/x', 'https://amazon.com.evil.org/x', 'https://user@www.amazon.com/x', 'http://www.amazon.com/x', 'javascript:alert(1)', 'https://www.amazon.com:444/x']) expect(isAmazonUrl(url)).toBe(false);
    });
});
