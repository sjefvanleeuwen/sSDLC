# secure-software-development

Reference implementation of an automated Secure Software Development Lifecycle (sSDLC) pipeline using free, open-source security tools on GitHub Actions.

## Why This Exists

Engineering teams pursuing ISO/IEC 27001:2022 compliance need a working example of how security scanning, audit evidence, and deployment controls fit together in practice — not just policy documents. This repository is that example and produces the evidence defined in the [Audit-Evidence-Catalog.md](Audit-Evidence-Catalog.md).

## Target Audience

- **Engineers** onboarding to the secure development workflow
- **Security / Compliance leads** reviewing or demoing the pipeline to auditors
- **Platform / DevOps engineers** adopting the pipeline template into new repositories

---

## Pipeline Overview

The pipeline enforces security guardrails automatically on every PR and merge to `main`. No code reaches production without passing all checks.

:::mermaid
sequenceDiagram
    actor Developer
    participant Git as Git Repository
    participant Pipeline as CI/CD Pipeline
    participant Security as Open Source Scanners
    participant Deploy as CD (GitOps)

    Developer->>Git: Push Feature Branch
    Developer->>Git: Open Pull Request
    Git->>Pipeline: Trigger CI Scan
    activate Pipeline
    Pipeline->>Security: Run Gitleaks (Secrets)
    Pipeline->>Security: Run Semgrep (SAST)
    Pipeline->>Security: Run Trivy (SCA/Containers)
    Security-->>Pipeline: Results (JSON/JUnit)
    Pipeline-->>Git: Status Check (Pass/Fail)
    deactivate Pipeline
    
    Note over Developer, Git: Only "Green" builds can be merged
    
    Developer->>Git: Merge to Main
    Git->>Deploy: Sync State (ArgoCD/Flux)
:::

```
PR opened
 │
 ├─ Step 1  Gitleaks        → secrets in commit history
 ├─ Step 2  Semgrep (SAST)  → code vulnerabilities        → SARIF → inline annotations
 ├─ Step 3  Trivy (SCA)     → dependency & IaC CVEs        → SARIF → inline annotations
 ├─ Step 4  Trivy (Image)   → container image CVEs
 ├─ Step 5  DefectDojo      → centralized finding upload   (optional)
 └─ Step 6  PR Report       → summary comment on the PR
 │
 ▼
 Security Gate (all green → merge allowed → GitOps deploy)
```

SARIF results from Steps 2–3 appear as **inline annotations on the code diff**, so reviewers see findings on the exact lines without leaving the PR.

---

## Security Tools

| Tool | Category | Function |
|------|----------|----------|
| **[Gitleaks](https://github.com/gitleaks/gitleaks)** | Secret Scanning | Detects hardcoded secrets, keys, and tokens in the git history |
| **[Semgrep](https://semgrep.dev/)** | SAST | Static analysis for security bugs (SQLi, XSS, etc.) in source code |
| **[Trivy](https://github.com/aquasecurity/trivy)** | SCA / IaC | Scans dependencies, container images, and IaC for CVEs |
| **[OWASP ZAP](https://www.zaproxy.org/)** | DAST | Baseline dynamic scanning for running web applications |
| **[DefectDojo](https://www.defectdojo.org/)** | ASOC | Vulnerability management orchestration (optional, self-hosted) |

---

## Implementation Details

### Step 0: Centralized Security Bootstrap
Repositories use a mandatory remote template to ensure governance:
```yaml
include:
  - remote: 'https://security.enterprise.com/templates/ssd-pipeline-v1.yml'
```

### Step 1: Secret Scanning (Gitleaks)
Scans the entire commit history for secrets.
```yaml
gitleaks-scan:
  image: zricethezav/gitleaks:latest
  script:
    - gitleaks detect --source . --verbose --redact
```

### Step 2: Static Analysis (Semgrep)
Runs with the `p/security-audit` and `p/owasp-top-10` rulesets.
```yaml
semgrep-sast:
  image: returntocorp/semgrep
  script:
    - semgrep scan --config auto --error
```

### Step 3: Dependency & IaC Scanning (Trivy)
Checks dependencies, container images, and infrastructure files.
```yaml
trivy-sca:
  image: aquasec/trivy:latest
  script:
    - trivy fs --severity HIGH,CRITICAL --exit-code 1 .
```

### Step 4: Dynamic Application Security Testing (OWASP ZAP)
Baseline scan against the running staging application.
```yaml
zap-dast:
  image: ghcr.io/zaproxy/zaproxy:stable
  script:
    - zap-baseline.py -t $STAGING_URL -r zap-report.html -I
  artifacts:
    paths:
      - zap-report.html
```

### Step 5: Vulnerability Coordination (DefectDojo)
All scan results are uploaded for centralized tracking and deduplication.
```yaml
upload-to-defectdojo:
  script:
    - |
      curl -X POST "$DEFECTDOJO_URL/api/v2/reimport-scan/" \
        -H "Authorization: Token $DEFECTDOJO_TOKEN" \
        -F "scan_type=Trivy Scan" \
        -F "file=@trivy-results.json" \
        -F "product_name=$CI_PROJECT_NAME" \
        -F "engagement_name=CI Pipeline"
```

### Step 6: PR Reporting & Evidence

**6a. SARIF Upload (Inline Annotations)** — Semgrep and Trivy produce SARIF output that GitHub renders as inline annotations on the exact lines in the PR diff.
```yaml
- name: Upload Semgrep SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: semgrep-results.sarif
    category: semgrep

- name: Upload Trivy SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: trivy-results.sarif
    category: trivy
```

**6b. PR Comment Summary** — A sticky comment is posted on every pipeline run with scan results.
```yaml
- name: Post Security Summary to PR
  uses: marocchino/sticky-pull-request-comment@v2
  with:
    header: security-scan-results
    message: |
      ## 🔒 Security Scan Summary
      | Scanner | Category | Status | Findings |
      |---------|----------|--------|----------|
      | Gitleaks | Secrets | ${{ steps.gitleaks.outcome }} | ${{ steps.gitleaks.outputs.count || '0' }} |
      | Semgrep | SAST | ${{ steps.semgrep.outcome }} | ${{ steps.semgrep.outputs.count || '0' }} |
      | Trivy | SCA/IaC | ${{ steps.trivy.outcome }} | ${{ steps.trivy.outputs.count || '0' }} |
      | ZAP | DAST | ${{ steps.zap.outcome }} | See report artifact |
```

---

## Evidence & Audit Traceability

As defined in the [Audit Evidence Catalog](Audit-Evidence-Catalog.md), the pipeline automatically generates:

1. **Scan Reports:** Artifacts stored in GitHub Actions for a minimum of 90 days.
2. **Gate Status:** PRs are blocked unless all security tools exit `0`.
3. **Immutable Logs:** Pipeline execution logs forwarded to the centralized logging platform.
4. **PR-Level Evidence (Permanent):** SARIF annotations and PR summary comments are retained for the lifetime of the repository.

Every merged PR becomes a self-contained audit record: the diff, inline security findings, a summary comment, individual pass/fail checks, and the merge approval. Auditors can review any historical change by navigating to the PR without needing access to CI/CD or external tools.

---

## Branching & Deployment

Trunk-based: short-lived feature branches, PR to `main`, automated deploy from `main`.

```
feature/xyz ──PR──► main ──GitOps (ArgoCD/Flux)──► production
```

Direct pushes to `main` are blocked. Branch protection requires the Security Gate check and a Code Owner approval. Once merged, the GitOps controller (ArgoCD or Flux) automatically synchronizes the infrastructure/application state — no manual "Click-Ops" in Production.

---

## Quick Start

```bash
# 1. Enable branch protection (Settings → Branches → main)
#    Required status check: "Security Gate (Required)"
#    Require PR reviews + Code Owner approval

# 2. Open a PR and watch the pipeline run
git checkout -b feature/test
echo "// change" >> src/index.js
git add . && git commit -m "test: trigger pipeline"
git push -u origin feature/test
```

### DefectDojo (Optional)

Add a repo variable `DEFECTDOJO_URL` and a secret `DEFECTDOJO_TOKEN` under **Settings → Secrets and variables → Actions**. The pipeline uploads scan results automatically when configured.

---

## Repository Structure

```
.github/
  workflows/security-pipeline.yml   # CI security pipeline (Steps 1–6)
  branch-protection.json            # Documented branch protection settings
  CODEOWNERS                        # Required reviewers
src/index.js                        # Minimal Express app (demo target)
Dockerfile                          # Container build
package.json                        # App dependencies
Audit-Evidence-Catalog.md           # Evidence requirements per control
WoW-Security-&-Compliance.md        # Ways of Working
```
