# Feature Specification: Software Audit & Auto-PR Patching

## Overview
**Software Audit** is elevated to **Level 4 (Delegated / Production)**. It provides automated AST-level vulnerability remediation, surgical code patch synthesis, signed GitHub Auto-PR generation, and continuous cryptographic SBOM (Software Bill of Materials) attestations.

```
                 ┌───────────────────────────────────────┐
                 │     CVE Security Advisory Ingestion   │
                 └──────────────────┬────────────────────┘
                                    │
                                    ▼
                 ┌───────────────────────────────────────┐
                 │     AST Vulnerability Scanner         │
                 │   • Exact file & line occurrence map  │
                 │   • Package version vulnerability scan│
                 └──────────────────┬────────────────────┘
                                    │
                                    ▼
                 ┌───────────────────────────────────────┐
                 │     Surgical Auto-Patch Engine        │
                 │   • Safe AST replacement patterns     │
                 │   • Unified diff generation           │
                 └──────────────────┬────────────────────┘
                                    │
                                    ▼
                 ┌───────────────────────────────────────┐
                 │   Cryptographic SBOM Attestation      │
                 │   • CycloneDX v1.5 JSON schema        │
                 │   • SHA-256 integrity hash tree       │
                 │   • Digital signature generation      │
                 └──────────────────┬────────────────────┘
                                    │
                                    ▼
                 ┌───────────────────────────────────────┐
                 │      Signed Auto-Pull Request         │
                 │   • Benchmark diffs & commit message  │
                 │   • Continuous verification status    │
                 └───────────────────────────────────────┘
```

---

## Core Capabilities

### 1. Cryptographic SBOM Attestation
- `generateSbomAttestation(dependencies, rootCommitHash)` generates CycloneDX v1.5 compliant manifests with SHA-256 hashes per dependency and an attestation digital signature.

### 2. Line-Level Vulnerability Analysis
- `analyzeVulnerabilities(advisories, codebaseFiles)` scans target files and identifies exact line numbers, vulnerable snippets, and suggested surgical patches.

### 3. Surgical Code Diff Synthesis
- `synthesizePatchDiff(finding, targetFileContent)` generates unified patch diffs replacing vulnerable patterns with hardened call equivalents.

### 4. Auto-PR Generation
- `generateAutoPullRequest(findings, patches, sbomAttestation)` formats signed GitHub pull request payloads with CVE summary tables and SBOM audit badges.

### 5. Automated Verification
- Verified via [auto-patch.service.test.ts](../../domain/self-improvement/auto-patch.service.test.ts).
