# Financial calculation guidance for CREW agents

## Executable forecasting tools

`calculate_financial_forecast` now executes complete cash-flow schedules, explicit growth assumptions, least-squares trends, seasonal phase averages, scenario deltas and simplified integrated three statements. `quickbooks_forecast_cashflow` reads the scoped live source for a scheduled 13-week baseline and invokes the existing finance prediction bridge to assess shortfall. Preview confidence is heuristic, not calibrated; no prediction records are persisted. Forecast cards show currency, periods, calculations, assumptions and excluded commitments.

The exact room request “What is our projected cashflow?” executes the QuickBooks forecast preflight rather than searching knowledge or drafting an ACTION string. For other forecasts, agents must supply complete verified data and explicit assumptions. `calculate_dataset_prediction` remains available for dataset/predicate analysis through Hidden State and Prediction Pods; its output must not be mistaken for a currency time series. Spatial Prediction Studio is not a financial forecasting model.

The executable methods above supersede the corresponding reference-only limitations below. Other reference calculators and automatic board-package publication remain separate capabilities.

Every speaker receives `CREW_FINANCIAL_GUIDANCE` from the live speaker prompt. This adapts the supplied accounting-engine reference to registered capabilities; its seven Python functions are examples, not deployed tools.

## Execution workflow

1. Identify the question, organization/project, period, currency and exact source fields. Read the relevant records/reports. Ask for missing inputs instead of replacing them with zero.
2. Use `quickbooks_calculate_total` for supported unfiltered source totals, `calculate_dataset_metric` for complete filtered datasets, or execute an appropriate graph calculation. Use only tools available to the agent.
3. Require a successful result before reporting a metric. Preserve currencies separately and distinguish source totals from unpaid balances. Include coverage and source dates when returned.
4. Display money with a currency sign and decimal places; use distinct units for ratios, days and percentages. Present assumptions and interpretation separately.

Examples: “Outstanding invoices” uses Invoice / Balance / outstanding=true. “Original invoice value” uses Invoice / TotalAmt. “Unpaid bills” uses Bill / Balance / outstanding=true. A request for a specific customer or date range must retain those filters; the QuickBooks total tool does not support them.

Graph monetary references include `nodeId`, `variable`, `field`, and `currency`. Set monetary `outputUnit` to the verified ISO currency and execute the calculation. Reference fields and currencies are exposed through the agent capability as well as the service.

## Accounting-engine reference boundaries

The supplied reference covers liquidity, profitability, cash conversion, solvency, depreciation, break-even and amortization. Retrieve matching period inputs and use validated deterministic tools. Do not pretend the reference function names are callable. Schedules require an implemented schedule engine with reconciled rounding and explicit conventions; prompt-written schedules are not verified calculations.

Valid negative accounting values must remain signed. Positive-denominator requirements depend on the formula; zero interest is valid for an interest-free loan, while an undefined coverage ratio is unavailable. Do not hardcode USD. Visual status colors and ratio cutoffs are heuristics, not accounting-standard requirements. `ui_hint` suggestions do not establish frontend component support.

## Advanced finance reference

The second supplied reference extends the runtime guidance to seven additional areas. These Python examples are not registered capabilities either.

| Analysis | Required context and execution checks |
| --- | --- |
| FCFF / FCFE | Matching period EBIT, tax assumptions, D&A, CapEx, signed working-capital change, interest and net borrowing; label after-tax interest expense separately from the tax shield. |
| DuPont | Matching income measures and average assets/equity; validate denominators separately for three-factor and five-factor models. |
| NPV / IRR / payback | Time-zero outlay, signed flows, timing and discount convention; verify solver convergence, residuals and root ambiguity. Missing IRR is not an acceptance criterion. Distinguish nominal and discounted payback. |
| WACC | Market-value weights, sourced debt/equity costs, tax assumptions and consistent rate units. |
| Altman | Verify model label, coefficients, equity definition and thresholds together. The supplied private-model example is internally inconsistent and must not be used unchanged. A score is not a calibrated probability. |
| Operating / financial leverage | Period-consistent costs and income, validated denominators and explicit sensitivity assumptions. |
| Tax reconciliation | Jurisdiction, year, verified rates, signed differences and credit eligibility. The simplified reference is not a complete accounting provision. |

Agents must use executed, validated calculations rather than reproduce these examples in prose. Unsupported advanced calculations require a clear capability limitation. Tax defaults and visual risk judgments from the document are not authoritative rules. Source-currency formatting and existing approval requirements continue to apply to all fourteen areas.

## Treasury, costing and acquisition reference

The third reference contains three complete example functions. It ends midway through the DSCR function signature (no body or closing code fence), and mentions Beneish screening without supplying a function. None of these are registered tools. Runtime guidance covers the five topics while distinguishing complete examples from missing implementations.

| Topic | Required checks |
| --- | --- |
| Cash burn / runway | Available versus restricted/reserved cash; matching monthly flows and forecast assumptions. Report liquidity shortfalls and no-depletion cases explicitly, without a 999-month sentinel or hidden deficits. |
| Activity-based costing | Unique activity identities, positive volumes/units, known drivers, reconciled overhead pools, allocated/unallocated costs and rounding residuals. Unknown drivers must not silently cost zero. |
| M&A EPS | Separate cash, borrowing and stock funding; matched earnings and share definitions; explicit tax, synergies and costs. Compare EPS levels for direction; zero/negative baseline EPS makes percentage interpretation problematic. Equal EPS is neutral. |
| DSCR / refinancing | Complete repayment terms and contractual numerator, denominator, testing period and threshold. The supplied function is incomplete; a generic threshold is not evidence of a covenant breach. |
| Beneish screening | Validated model, comparable periods, inputs and model-specific threshold. No implementation was supplied; Altman must not be used as an earnings-manipulation detector. A screening warning is not proof of fraud. |

All presentation remains limited to supported components, and accounting/deal changes retain their existing approval requirements. No external alert or unsupported audit state is implied by a reference warning label.

## SaaS, FX and specialized risk reference

The fourth reference supplies one complete SaaS example and an FX example cut off inside its presentation payload. Portfolio/private-equity returns, pensions and VaR are mentioned without engines. These are reference topics, not new registered tools.

| Topic | Required context and checks |
| --- | --- |
| SaaS economics | Matched cohort and period; ARR movements, retention scope, spend timing, CAC, ARPU and gross margin. Resolve the Magic Number annualization discrepancy before calculation. Use measured churn with explicit frequency; no arbitrary 1% floor or automatic annual-to-monthly division. Undefined LTV/payback or spend ratios remain unavailable. |
| FX forward / exposure | Currency pair, quote direction, receivable/payable direction, dates, sourced rates, day count and compounding. Pair-specific rate/pip precision; distinguish theoretical pricing from contracted settlement, scenario proceeds and discounted fair value. The supplied function is incomplete. |
| Portfolio / private equity | Dated signed cash flows, ending value, fees, currency and return definition. No engine supplied. |
| Pensions | Measurement date, plan-specific actuarial inputs, assets, obligation definition and reporting basis. Example funding cutoffs are not legal requirements. No engine supplied. |
| VaR | Method, confidence, horizon, return/volatility units, exposures and dependence assumptions. Time scaling requires justified assumptions; no regulatory compliance claim from an example. No engine supplied. |

Runtime guidance directs agents to existing validated tools and explicit capability limitations, preserving the original deterministic-execution, evidence, currency and supported-presentation rules.

## Equity compensation, inventory and structuring reference

The fifth reference supplies a complete option example and an EOQ example that stops at an unfinished `for` statement. Real options and securitization waterfalls are mentioned without functions. None are registered capabilities.

| Topic | Required context and checks |
| --- | --- |
| Equity compensation | Valuation date, expected option term, share/strike prices, annualized rate/volatility units, currency and actual award count. Vesting time is not automatically expected option life. Separate valuation from recognition under the actual award terms and reporting basis. Validate boundary cases and label Greek units. |
| EOQ / inventory policy | Demand/cost time units, operating calendar, lead time, variability and service assumptions. Validate scaling assumptions and feasible quantities; disclose omitted costs and constraints. The example is incomplete and inventory optimization does not establish accounting valuation. |
| Real options | Explicit exercise rights, project model, timing, rates/volatility and validated pricing engine. No implementation supplied. |
| Debt waterfalls | Contractual priority, tranche principals, triggers, recoveries and loss amount. Distinguish payments from loss allocation; reconcile all principal/loss/residuals. No implementation supplied. |

Reference defaults, compliance claims and visualization labels do not substitute for verified inputs, executed tools or supported rendering components.

## FP&A forecasting and reporting reference

The sixth reference contains a complete PVM example and a three-statement example that ends at an unfinished `equity` statement. Rolling forecasts, scenario tests and board packages are mentioned without implementations. Neither named example is a registered tool.

| Topic | Required context and checks |
| --- | --- |
| Price-volume-mix | Matched periods/currency and comparable units; unique product keys; explicit treatment of missing/new/discontinued products. Verify aggregate effects equal revenue variance and separately check product-level attribution. Reconcile displayed rounding residuals at the currency's minor-unit precision. |
| Three statements | Balanced opening data, complete assumptions and period calendar. Every forecast period must reconcile the balance sheet, cash flow, retained earnings, debt and fixed assets. Plugs must follow real financing policy and cannot conceal model errors. The reference implementation is incomplete. |
| Rolling forecasts | Explicit actual/forecast cutoff, version, horizon and deterministic drivers; retain completed actual periods. No engine supplied. |
| Stress scenarios | Named assumptions and financing/covenant constraints; no invented probabilities, uncertainty bands or universal color thresholds. No engine supplied. |
| Board packages | Verified metrics, validation status and assumptions; use available artifact tools and claim export/delivery only after execution. No automation engine supplied. |

These additions extend the live speaker guidance; they do not deploy the reference Python engines. All calculations still require an available validated tool and successful execution.
