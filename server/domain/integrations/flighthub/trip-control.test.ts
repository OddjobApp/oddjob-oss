import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { setTripType } from './trip-control.js';
let browser: Browser;
let page: Page;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });
async function fixture(html: string) { page = await browser.newPage(); await page.setContent(html); }
describe('FlightHub trip controls in an actual browser', () => {
    it('selects and verifies roundtrip in a native dropdown', async () => {
        await fixture('<select name="trip"><option value="one_way">One-way</option><option value="round_trip">Round-trip</option></select>');
        await setTripType(page, 'roundtrip');
        expect(await page.locator('select').inputValue()).toBe('round_trip');
    });
    it('sets hidden native radios through their visible labels', async () => {
        await fixture('<input hidden id="ow" type="radio" name="trip" value="oneway"><label for="ow">One-way</label><input hidden id="rt" type="radio" name="trip" value="roundtrip" checked><label for="rt">Round-trip</label>');
        await setTripType(page, 'oneway');
        expect(await page.locator('#ow').isChecked()).toBe(true);
    });
    it('verifies an ARIA tab selection', async () => {
        await fixture(`<button role="tab" aria-selected="false" onclick="this.setAttribute('aria-selected','true')">Round Trip</button>`);
        await setTripType(page, 'roundtrip');
        expect(await page.locator('button').getAttribute('aria-selected')).toBe('true');
    });
    it('opens a custom menu and verifies its resulting selection', async () => {
        await fixture(`<button id="trip" onclick="document.querySelector('#menu').hidden=false">Round trip</button><div id="menu" hidden><button role="option" onclick="document.querySelector('#trip').textContent='One way';document.querySelector('#menu').hidden=true">One way</button></div>`);
        await setTripType(page, 'oneway');
        expect(await page.locator('#trip').textContent()).toBe('One way');
    });
    it('reports the real browser failure instead of blaming airport codes', async () => {
        await fixture('<p>No search form available</p>');
        await expect(setTripType(page, 'roundtrip')).rejects.toThrow(/browser-control failure, not an airport-code/);
    });
});
