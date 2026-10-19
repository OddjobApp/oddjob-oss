import { tryEvaluateExpression } from "../../shared/form-expression";
import { evaluateStudio } from "../../shared/form-studio";
import { definitionFromLegacyForm } from "../../shared/form-studio-legacy";

const scope = { bill: "80", tip: 15, rate: 6.5, years: 30, principal: "300000", name: "ada lovelace", empty: "", flag: true, zero: 0, n: "12abc", list: ["a", "b"] };
const exprs = [
  "bill + tip", "bill * tip / 100", "round(bill * tip / 100, 2)", "-pmt(rate / 100 / 12, years * 12, principal)",
  "round(-pmt(rate / 100 / 12, years * 12, principal), 2)", "pv(0.05/12, 360, -1500)", "fv(0.05, 10, -100)", "nper(0.01, -100, 1000)",
  "rate(360, -1896.2, 300000)", "bill > 50 ? 'big' : 'small'", "bill == 80", "name + ' x'", "upper(name)", "title(name)",
  "len(name)", "left(name, 3)", "right(name, 0)", "right(name, 4)", "substr(name, -8, 4)", "replace(name, 'a', 'A')",
  "contains(name, 'LOVE')", "coalesce(empty, 'fallback')", "if(flag, 1, 2)", "and(flag, zero)", "or(zero, flag)", "not(zero)",
  "-2 ^ 2", "2 ^ 3 ^ 2", "10 % 3", "-7 % 3", "bill / zero", "missingField + 1", "empty * 2", "flag && empty", "!flag || empty",
  "min(3, 1, 2)", "max()", "sum(1, '2', '$3,000')", "avg(1, 2)", "clamp(15, 0, 10)", "sqrt(2)", "atan2(1, 1)", "1 / 3",
  "0.1 + 0.2", "1e3", "1.2.3", "n + 1", "concat(1, true, 'x')", "1 +", "foo(1)", "a ? b", "1 # 2", "(1 + 2", "floor(-2.5)", "round(-2.5)",
  "list", "100000000000000000000000", "0.0000001 * 1", "123456789.123456789",
];
const expressions = exprs.map((expr) => {
  const o = tryEvaluateExpression(expr, scope);
  return { expr, ok: o.ok, value: o.ok ? o.value : null, missing: (o as any).missing ?? null, error: (o as any).error ?? null, str: o.ok ? String(o.value) : null };
});

const forms = [
  { title: "Mortgage Calculator", schema: { fields: [
      { key: "principal", type: "number", label: "Loan Amount", required: true },
      { key: "interestRate", type: "number", label: "Annual Interest Rate (%)", required: true },
      { key: "loanTerm", type: "number", label: "Loan Term (Years)", required: true },
      { key: "monthlyPayment", type: "computed", label: "Monthly Payment", format: "currency", formula: "-pmt(interestRate / 100 / 12, loanTerm * 12, principal)" } ] },
    inputs: { principal: "300000", interestRate: "6.5", loanTerm: "30" } },
  { title: "Mortgage Calculator", schema: { fields: [
      { key: "principal", type: "number", label: "Loan Amount", required: true },
      { key: "monthlyPayment", type: "computed", label: "Monthly", formula: "principal / 12" } ] }, inputs: {} },
  { title: "Tip", schema: { fields: [
      { key: "total", type: "computed", label: "Total", formula: "bill + tipAmount" },
      { key: "bill", type: "currency", label: "Bill", required: true },
      { key: "tipAmount", type: "computed", label: "Tip", formula: "round(bill * pct / 100, 2)" },
      { key: "pct", type: "dropdown", label: "Tip %", options: ["10", "15", "20"], required: true },
      { key: "agree", type: "checkbox", label: "Agree", required: true },
      { key: "tags", type: "checkboxes", label: "Tags", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
      { key: "score", type: "rating", label: "Score", min: 1, max: 5 } ] },
    inputs: { bill: "80", pct: "15", agree: true, tags: ["b"], score: 4 } },
  { title: "Tip", schema: { fields: [
      { key: "pct", type: "select", label: "Tip %", options: ["10", "15"] },
      { key: "bill", type: "number", label: "Bill", min: 0, max: 100 },
      { key: "agree", type: "boolean", label: "Agree", required: true } ] },
    inputs: { pct: "99", bill: "250", agree: false } },
];
const formResults = forms.map((f) => {
  const { definition, initialInputs } = definitionFromLegacyForm(f.schema, {});
  const inputs = { ...initialInputs, ...f.inputs };
  const { values, errors } = evaluateStudio(definition, inputs, true);
  const data = { ...inputs, ...values };
  return { title: f.title, schema: f.schema, inputs: f.inputs, errors, message: `I submitted the "${f.title ?? "form"}" with: ${JSON.stringify(data)}` };
});
console.log(JSON.stringify({ scope, expressions, forms: formResults }, null, 1));
