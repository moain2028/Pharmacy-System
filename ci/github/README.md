# GitHub Actions workflow (staged)

`ci.yml` is the CI pipeline (pnpm install → build → typecheck → lint → test with a PostgreSQL 16 service).

It lives here instead of `.github/workflows/` because the GitHub App token used by the AI
developer has no `workflows` permission and GitHub refuses pushes that create or modify
workflow files.

**To activate (repo owner, one-time):**
```bash
git mv ci/github/ci.yml .github/workflows/ci.yml && git commit -m "ci: activate workflow" && git push
```
or grant the app the `workflows` permission and the agent will move it.
