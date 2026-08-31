# Release Discipline

An approved production fix is complete only after this sequence:

`IMPLEMENT -> VERIFY -> COMMIT -> PUSH BRANCH -> PR -> build-and-verify -> MERGE -> CLOUDFLARE PAGES -> LIVE VERIFY`

Local PASS is not a completion state. If delivery cannot continue, report:

`NOT DEPLOYED - BLOCKER: <exact blocker>`

Production changes must use a focused branch and pull request. Never push directly to `main` or bypass the required `build-and-verify` check. For frontend-only changes, verify `release.json` and the live artifact on Cloudflare Pages; Railway is only part of the release when backend behavior changes.
