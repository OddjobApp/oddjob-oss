/** Hermetic browser check: no production accounts, external sites, or database writes. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { replayStep } from "../../server/domain/integrations/trycua/learned-skills.service.js";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  await page.setContent(`<label>Account<input id="account"></label>
    <button id="search" onclick="document.querySelector('td').textContent = document.querySelector('input').value">Search</button>
    <table><tr><th>Account</th></tr><tr><td>Before</td></tr></table>
    <a id="download" download="invoice.csv">Export</a>
    <script>document.querySelector('a').href=URL.createObjectURL(new Blob(['account,amount\\nAcme,10'],{type:'text/csv'}));</script>`);
  const base = { url: "https://fixture.invalid", at: 0 };
  const fill = await replayStep(page, { ...base, kind: "fill", target: { tag: "input", css: "#account" }, value: "{{company}}" }, { company: "Different account" }, 999999);
  assert.equal(fill.outcome, "ok");
  await replayStep(page, { ...base, kind: "click", target: { tag: "button", css: "#search" } }, {}, 999999);
  await replayStep(page, { ...base, kind: "wait", target: { tag: "table", css: "table" } }, {}, 999999);
  const table = await replayStep(page, { ...base, kind: "extract", target: { tag: "table", css: "table" }, output: "accounts", extractMode: "table" }, {}, 999999);
  assert.deepEqual(table.output, [[["Account"], ["Different account"]]]);
  const secret = await replayStep(page, { ...base, kind: "fill", secret: "otp", target: { tag: "input", css: "#account" } }, {}, 999999);
  assert.match(secret.outcome, /user must enter/);
  const download = await replayStep(page, { ...base, kind: "click", target: { tag: "a", css: "#download" }, output: "invoice" }, {}, 999999);
  assert.equal(download.outcome, "ok");
  const output = download.output as { path: string; url: string };
  assert.match(await readFile(output.path, "utf8"), /Acme,10/);
  assert.match(output.url, /^\/api\/integrations\/trycua\/skill-artifacts\//);
  console.log("Teach-task browser smoke passed: parameter substitution, replay, wait, table extraction, secret handoff and persisted download.");
} finally {
  await browser.close();
}
