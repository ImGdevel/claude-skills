---
name: disk-report
description: Scan a Windows drive (default C:) and publish a full disk-usage report artifact - every byte split into non-overlapping categories, a drill-down folder explorer, installed apps with last-use dates, leftover AppData folders, and change since the last scan. Use when the user asks why their disk is full, what is using space, for a disk/storage report, to re-run or refresh the disk report, or invokes /disk-report. Read-only; never deletes anything.
model: haiku
---

# Disk report

Reusable pipeline that measures every file on a drive and turns it into the "C: 드라이브 사용 내역" report page. Reply to the user in Korean.

## Run

1. Run the pipeline (read-only; ~1-2 min). Use the PowerShell tool with a 600000 ms timeout:

   ```powershell
   pwsh -NoProfile -File "${CLAUDE_SKILL_DIR}\scripts\run.ps1" -Drive C:
   ```

   - Other drive: `-Drive D:`.
   - Output folder: `%USERPROFILE%\.disk-report\<yyyy-MM-dd_HHmm>_<drive>\` with `report.html`, `data.json`, `apps.json`, `disk.json`. Each run's `data.json` is kept so the next run shows "지난번보다 +/-GB".
   - The console prints the category totals, change vs the previous run, and the report path. Korean in nested console output can come out garbled, so read `summary.txt` in the output folder (UTF-8) with the Read tool for the numbers you report.

2. Publish `report.html` with the Artifact tool.
   - C: drive report lives at **https://claude.ai/artifact/Kt9aAGiGGxR44wLygmUncZ**. Update that one in place: first `action: "read"` on the URL (required before publishing to an artifact from another conversation), then publish with `url` set to it and `file_path` = the new `report.html`. Omit `icon`.
   - Other drives: publish as a new artifact (icon `chart`) and add its URL to this file under "Known reports".

3. Answer in chat, short:
   - used / free / total, and the change since the last scan if the script printed one;
   - top 3-5 categories and anything that grew noticeably;
   - big "90일 넘게 안 씀" apps and "연결된 앱 없음" AppData folders as *candidates*;
   - the report link.

## Local app (open it, it refreshes itself)

`scripts/app.py` is a small local web app (stdlib only, listens on 127.0.0.1:47831, rejects foreign Host/Origin). The Desktop shortcut **디스크 리포트** starts it: the browser opens on the last report immediately, a background scan runs `run.ps1`, and the page reloads itself when the new report is ready (banner bottom right, "다시 측정" button). It exits by itself ~5 min after the tab is closed. A second launch reuses the running copy and just asks it to refresh. Comparison baseline: newest run at least 6h old, else the oldest run; the newest 40 run folders are kept.

- Launch by hand: `pythonw -I "${CLAUDE_SKILL_DIR}\scripts\app.py" --drive C:` (flags: `--port`, `--no-browser`, `--no-scan`, `--idle <sec>`).
- Shortcut missing? Recreate it on the Desktop: target = `pythonw.exe`, arguments = `-I "<path to app.py>" --drive C:`, icon `shell32.dll,8`.
- The published artifact is a static copy and only changes when Claude republishes it (see Run, step 2).

## VM disks (WSL / Docker Desktop)

Space freed inside a VM does not shrink the host `.vhdx` by itself (they are not sparse). `scripts/vm-compact.ps1` does the safe sequence: Docker build-cache prune, `fstrim` in each distro, stop Docker and WSL, elevated `diskpart` `compact vdisk` (one UAC prompt), restart Docker. `-DryRun` lists the disks and sizes only. First run on 2026-11-08: docker_data.vhdx 55.4 -> 25.7 GB, Ubuntu 15.0 -> 4.1 GB.

- It stops Docker containers and all WSL sessions for a few minutes: confirm with the user before running it.
- Do not run `docker system prune` blindly: stopped containers (kafka, mysql, mongo ...) and volumes hold real data. Build cache is the safe part (`docker builder prune -a -f`).
- `wsl --manage <distro> --set-sparse true` is refused on WSL 2.6.1 without `--allow-unsafe` (data-corruption risk); do not add that flag without a backup and the user's explicit OK.

## Rules

- Never delete, uninstall, empty the Recycle Bin, compact disks or change settings from this skill. Suggest actions; do them only after the user explicitly confirms each one.
- "마지막 사용" is evidence, not proof: Windows run history (UserAssist) covers only some apps, BAM/Prefetch need admin, NTFS last-access is disabled. Fallback is the folder's newest file date, which updates also change. Say so when recommending removal.
- "연결된 앱 없음" is a name-match heuristic; treat as a candidate list.
- If "기타 앱 · 데이터" holds a large item (>2GB) that clearly belongs to a category, add its path to `scripts/categories.json` (first match wins; `{U}` = user profile) and re-run the report step, so the fix persists for future runs.

## Files

- `scripts/run.ps1` - orchestrates everything.
- `scripts/fullscan.ps1` - one-pass size scan of the whole drive (C#, skips reparse points, ignores inaccessible).
- `scripts/apps.ps1` - installed apps (registry) + UserAssist run history.
- `scripts/newest.ps1` - newest-file date per folder (last-use fallback).
- `scripts/build.py` - categories, folder tree, app last-use (Steam LastPlayed, Epic manifests), AppData leftovers, previous-run comparison; renders the report.
- `scripts/categories.json` - category definitions; edit to tune.
- `scripts/template.html` - report page (data injected at `/*DATA*/null`).

## Known reports

- C: - https://claude.ai/artifact/Kt9aAGiGGxR44wLygmUncZ
