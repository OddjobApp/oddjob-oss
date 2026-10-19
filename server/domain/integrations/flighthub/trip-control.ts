import type { Page, Locator } from 'playwright';
import type { FlightTripType } from './types.js';

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');
const matches = (value: string, type: FlightTripType) => type === 'roundtrip'
    ? ['roundtrip', 'return', 'round'].includes(normalize(value))
    : ['oneway', 'one'].includes(normalize(value));

async function clickRadio(page: Page, input: Locator) {
    if (await input.isVisible()) await input.check();
    else {
        const id = await input.getAttribute('id');
        const label = id ? page.locator('label').filter({ has: page.locator(`input[id=${JSON.stringify(id)}]`) }) : null;
        // External labels are common when the styled radio hides its input.
        const external = id ? page.locator(`label[for=${JSON.stringify(id)}]`) : null;
        if (external && await external.count() && await external.first().isVisible()) await external.first().click();
        else if (label && await label.count()) await label.first().click();
        else throw new Error('Hidden trip-type radio has no selectable label.');
    }
    return input.isChecked();
}

/** Supports native selects, labelled radios, ARIA tabs and custom menus. */
export async function setTripType(page: Page, type: FlightTripType): Promise<void> {
    const selects = page.locator('select');
    for (let i = 0; i < await selects.count(); i++) {
        const select = selects.nth(i);
        if (!await select.isVisible()) continue;
        const options = await select.locator('option').evaluateAll(es => es.map(e => ({ value: (e as HTMLOptionElement).value, text: e.textContent ?? '' })));
        const option = options.find(o => matches(o.value, type) || matches(o.text, type));
        if (option) {
            await select.selectOption(option.value);
            if (await select.inputValue() === option.value) return;
        }
    }
    const radios = page.locator('input[type="radio"]');
    for (let i = 0; i < await radios.count(); i++) {
        const radio = radios.nth(i);
        const value = await radio.getAttribute('value') ?? '';
        const name = await radio.getAttribute('aria-label') ?? '';
        const id = await radio.getAttribute('id');
        const label = id ? await page.locator(`label[for=${JSON.stringify(id)}]`).first().textContent().catch(() => '') : '';
        if ((matches(value, type) || matches(name, type) || matches(label ?? '', type)) && await clickRadio(page, radio)) return;
    }
    const targetName = type === 'roundtrip' ? /^round[\s-]*trip$|^return$/i : /^one[\s-]*way$/i;
    const candidate = () => page.getByRole('radio', { name: targetName }).or(page.getByRole('tab', { name: targetName }))
        .or(page.getByRole('option', { name: targetName })).or(page.getByRole('button', { name: targetName }));
    let target = candidate();
    if (!await target.count() || !await target.first().isVisible()) {
        const opener = page.getByRole('button', { name: /^(?:round[\s-]*trip|one[\s-]*way|return|trip type)(?:\s*[▾▼])?$/i })
            .or(page.getByRole('combobox', { name: /trip/i }));
        if (await opener.count() && await opener.first().isVisible()) {
            await opener.first().click();
            target = candidate();
        }
    }
    const visible = await target.all();
    for (const control of visible) {
        if (!await control.isVisible()) continue;
        const role = await control.getAttribute('role');
        await control.click();
        if (await control.getAttribute('aria-checked') === 'true' || await control.getAttribute('aria-selected') === 'true') return;
        // A menu closes onto its current selection; verify its displayed value.
        const selected = page.getByRole('button', { name: targetName });
        if (await selected.count() && await selected.first().isVisible()
            && role === 'option') return;
        const returnField = page.locator('input[name*="return" i], input[id*="return" i], input[aria-label*="return" i]').first();
        if (await returnField.count() && await returnField.isVisible() === (type === 'roundtrip')) return;
    }
    throw new Error(`FlightHub page layout: the ${type} control could not be selected and verified. This is a browser-control failure, not an airport-code or ontology problem. Keep trip_type as roundtrip or oneway; do not change it to round-trip.`);
}
