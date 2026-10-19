import { evalFormula } from "../domain/core/ui/components/shared/formula.js";

const cases: Array<[string, Record<string, any>, any]> = [
    ["1 + 2 * 3", {}, 7],
    ["(1 + 2) * 3", {}, 9],
    ["10 % 3", {}, 1],
    ["-5 + 2", {}, -3],
    ["bill * tipPercent / 100", { bill: 80, tipPercent: 15 }, 12],
    ["round(bill * tipPercent / 100, 2)", { bill: 79.99, tipPercent: 18 }, 14.4],
    ["bill + tip", { bill: 80, tip: 12 }, 92],
    ["concat(first, ' ', last)", { first: "Ada", last: "Lovelace" }, "Ada Lovelace"],
    ["upper(name)", { name: "ada" }, "ADA"],
    ["title(name)", { name: "ada lovelace" }, "Ada Lovelace"],
    ["'Total: ' + round(a + b, 2)", { a: 1.111, b: 2.222 }, "Total: 3.33"],
    // comparison + logical (the gap we fixed)
    ["if(bill > 100, bill * 0.1, 0)", { bill: 150 }, 15],
    ["if(bill > 100, bill * 0.1, 0)", { bill: 50 }, 0],
    ["bill > 100 && tipPercent >= 20", { bill: 150, tipPercent: 20 }, true],
    ["bill > 100 && tipPercent >= 20", { bill: 150, tipPercent: 10 }, false],
    ["qty == 0 || price == 0", { qty: 0, price: 5 }, true],
    ["!done", { done: false }, true],
    ["if(score >= 90, 'A', if(score >= 80, 'B', 'C'))", { score: 85 }, "B"],
    // helpers
    ["coalesce(nick, name)", { nick: "", name: "Ada" }, "Ada"],
    ["left(name, 3)", { name: "Lovelace" }, "Lov"],
    ["right(name, 4)", { name: "Lovelace" }, "lace"],
    ["contains(email, '@')", { email: "a@b.com" }, true],
    ["sum(a, b, c)", { a: 1, b: 2, c: 3 }, 6],
    ["clamp(x, 0, 10)", { x: 42 }, 10],
    // coercion: numeric strings from number inputs
    ["bill * 1", { bill: "50" }, 50],
    ["'$' + bill", { bill: "80" }, "$80"],
    // safety + graceful failure
    ["bill * ", { bill: 5 }, 0],
    ["unknownFn(5)", {}, 0],
    ["missing + 1", {}, 1],
];

let pass = 0, fail = 0;
for (const [expr, scope, want] of cases) {
    const got = evalFormula(expr, scope);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) pass++; else { fail++; console.log(`FAIL: ${expr}  scope=${JSON.stringify(scope)}  got=${JSON.stringify(got)}  want=${JSON.stringify(want)}`); }
}
console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : " ✓"}`);
process.exit(fail ? 1 : 0);
