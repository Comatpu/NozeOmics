# NozeOmics

Windows desktop workspace for GEO bulk RNA-seq, AI-assisted sample mapping,
differential expression, and interactive Trend, MA, heatmap and PCA plots.

## Download

Download **NozeOmics.exe** from [Releases](https://github.com/Comatpu/NozeOmics/releases/latest).
Place it in a writable folder and run it. Python, R and statistical dependencies
are bundled. Projects are stored in the adjacent **NozeOmics_data** folder.
Keep that folder when replacing the EXE. Use **logo menu → Quit** to stop the app;
closing its window leaves it in the tray.

Create a project, add GSEs, assign Control/Treated samples and ask the connected
AI to review the batch. Approved data opens in Analysis. The first launch
registers NozeOmics in Codex; **logo menu → AI connection** checks or repairs
registration. Restart Codex if the tools are not listed yet.
Other MCP clients can use the exported configuration and the workflow skill in
`plugin/skills/nozeomics-analysis/SKILL.md`.

## Updates

The v0.2.0 portable launcher checks signed metadata on fresh desktop startup.
Newer compatible stable releases are downloaded and applied automatically.
Offline/verification failures keep the installed version; a failed updated
startup returns to the previous version. Reload does not check online.
Executables without the updater must be replaced once.

A source commit on `main` alone is not an application update. A signed Release
must be published. See [Automatic updates](docs/AUTOMATIC_UPDATES.md).

## Analysis

Effects are Treated versus Control. Counts use TMM/filtering and limma-voom;
supported normalized expression uses log2(value + 0.1) and limma-trend.
Verified batch/paired designs are retained during recalculation.
PCA uses centered log expression without unit-variance scaling, defaulting to
500 variable genes from one compatible tissue cohort. Heatmaps use gene-wise
population z-scores and average-linkage clustering. PCA is exploratory; a
DEG-only table cannot provide sample PCA. Pathway analysis is planned.

Data/calculations stay local. Previews requested by an external AI are sent to
that AI service under its terms. Ambiguous GEO mappings require review.

## Source and Windows build

`Code → Download ZIP` and `git clone` provide source code. For normal use,
download the EXE from Releases instead.

- `frontend/`: visualization and UI
- `backend/`: data handling and analysis
- `desktop/`: Electron application and portable updater
- `mcp/`, `plugin/`: AI tools and workflow
- `scripts/`, `tests/`: build/release helpers and development checks

Build requirements: Windows x64, Node.js 24, Python 3.12, R 4.5 and the .NET
Framework C# compiler. Runtime provisioning is currently manual.

```powershell
npm install --no-save electron@44.5.1 @electron/packager@20.3.0 esbuild@0.28.2 @modelcontextprotocol/sdk@1.32.0
$env:NOZEOMICS_BUILD_DEPS = Join-Path (Get-Location) 'node_modules'
python -m pip install requests
python scripts/acquire_runtime.py
python -m pip install --target runtime/python/Lib/site-packages -r requirements.txt
```

Place a Windows R 4.5 installation in `runtime/R`, including `bin/Rscript.exe`,
then run:

```powershell
& ./runtime/R/bin/Rscript.exe scripts/setup_r.R
New-Item -ItemType Directory -Force fixtures | Out-Null
node scripts/package.mjs
```

The unpacked app is `release/NozeOmics-win32-x64/NozeOmics.exe`.
Set `NOZEOMICS_HOME` to an isolated development data folder before testing.
Some older helpers/UI tests assume the maintainer's local layout and are
included as development references. User data, generated builds, runtime
binaries and private signing keys are not part of this source repository.
Official updates require the maintainer's undistributed private signing key.

## License

NozeOmics source is under the [MIT License](LICENSE). Third-party dependencies
retain their own licenses; see `docs/third-party/` and the bundled runtime notices.
