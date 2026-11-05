# Windows x64 build from this fork

The **Windows session ID build** GitHub Actions workflow runs on pushes to
`feature/explicit-session-id` and can also be started manually from the Actions
page. After a successful run, download the `omp-windows-x64` artifact from the
run's summary. It contains `omp-windows-x64.exe` and `SHA256SUMS.txt`.

In PowerShell, verify the executable against the accompanying checksum:

```powershell
Get-FileHash -Algorithm SHA256 .\omp-windows-x64.exe
Get-Content .\SHA256SUMS.txt
.\omp-windows-x64.exe --session-id 550e8400-e29b-41d4-a716-446655440000
```

Compare the two SHA-256 values before running the executable. The workflow uses
upstream's baseline x64 native addon and release compiler, then runs focused
tests and exercises the executable on a GitHub-hosted Windows runner. The
session smoke test uses an isolated home and does not send an inference request.
GitHub Actions artifacts expire according to the repository's artifact-retention
settings.
