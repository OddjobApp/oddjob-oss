# Code Review Checklist (AI & Human)

**PR Title:** [PR Title]
**Reviewer:** [AI Code Reviewer / Human]

## 1. Compliance & Security Check
- [ ] No hardcoded passwords, API keys, or database credentials.
- [ ] Inputs are sanitized to prevent SQL injection and XSS.
- [ ] Sensitive data is encrypted in transit and rest.

## 2. Functional & Logical Verification
- [ ] Code matches the requirements in the Functional Spec.
- [ ] Edge cases (empty payload, nulls) are gracefully handled.
- [ ] No recursive loops or unhandled promises.

## 3. Style & Standards
- [ ] Code adheres to the organization's Coding Standards.
- [ ] Code is well-documented with docstrings and comments.
- [ ] No dead code or unused imports left behind.
