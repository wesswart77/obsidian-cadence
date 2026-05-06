# Submission walkthrough

Step-by-step to get Cadence into the Obsidian community plugin store. Follow in order. Every command is copy-paste runnable from `~/Documents/obsidian-cadence/`.

## Pre-flight

Confirm these:

- [ ] `manifest.json` `id` is `cadence-planner` (locked — already in use by your local vault; changing it would orphan your data)
- [ ] `manifest.json` `name` is `Cadence`
- [ ] `manifest.json` `version` matches the tag you're about to create (`0.13.0`)
- [ ] `versions.json` lists `0.13.0` → `1.4.0`
- [ ] `LICENSE` is in place
- [ ] Code audit clean (no `console.log`, no `innerHTML`, frontmatter via `processFrontMatter`, vault events via `registerEvent`, intervals via `registerInterval`) ✓
- [ ] Author + authorUrl in `manifest.json` are correct (currently `Wesley Swart` + `https://github.com/wesswart77` — change if your handle differs)

## Step 1 — Take screenshots

Run from `~/Documents/obsidian-cadence/`. For each, navigate Obsidian to the surface, then run the command. macOS shows a window-picker cursor — click your Obsidian window once.

```bash
cd ~/Documents/obsidian-cadence

# 1. Home / Command Centre — both columns visible
screencapture -W -x docs/screenshots/01-home.png

# 2. Inbox — with a few captured items, ideally one in NOW
screencapture -W -x docs/screenshots/02-inbox.png

# 3. Pipeline kanban — with deals across stages
screencapture -W -x docs/screenshots/03-pipeline.png

# 4. Project detail — with milestones, progress bar, Brief filled in
screencapture -W -x docs/screenshots/04-project.png

# 5. Quick capture modal open — text + Remind me toggled
screencapture -W -x docs/screenshots/05-capture.png

# 6. New Deal modal — fields visible
screencapture -W -x docs/screenshots/06-new-deal.png

# 7. CSV Import modal with column mapping table visible
screencapture -W -x docs/screenshots/07-import.png
```

Tip: maximize the Obsidian window first (or resize to ~1440×900) for clean framing. After each shot, check the file isn't tiny: `ls -lh docs/screenshots/`.

## Step 2 — Install GitHub CLI (one-time)

```bash
brew install gh
gh auth login
```

Choose GitHub.com → HTTPS → Login with a web browser.

## Step 3 — Create the repo + push

```bash
cd ~/Documents/obsidian-cadence
git init
git add .
git commit -m "Initial release of Cadence v0.13.0"
gh repo create wesswart77/obsidian-cadence --public --source=. --push --description "A workspace for working life in Obsidian — CRM, PRM, Planner, Reports. Markdown source-of-truth."
```

Verify it's live: `gh repo view --web`.

## Step 4 — Create the release with the three required assets

```bash
cd ~/Documents/obsidian-cadence
gh release create 0.13.0 \
  main.js manifest.json styles.css \
  --title "0.13.0 — initial submission" \
  --notes "First public release. CRM, PRM, Planner, Reports, Inbox + reminders, rich Project detail. Markdown source-of-truth."
```

**The tag must match `manifest.json.version` exactly** — no `v` prefix. The bot rejects mismatches.

## Step 5 — Submit the PR to obsidian-releases

```bash
cd /tmp
gh repo clone obsidianmd/obsidian-releases
cd obsidian-releases
git checkout -b add-cadence
```

Open `community-plugins.json`. Find a sensible alphabetical spot for `cadence-planner` and add:

```json
{
  "id": "cadence-planner",
  "name": "Cadence",
  "author": "Wesley Swart",
  "description": "A workspace for working life: Home command centre, CRM, PRM, Planner with reminders and rich projects, Reports. Markdown source-of-truth, no server required.",
  "repo": "wesswart77/obsidian-cadence"
},
```

Then:

```bash
git add community-plugins.json
git commit -m "Add Cadence plugin"
git push -u origin add-cadence
gh pr create --repo obsidianmd/obsidian-releases \
  --title "Add plugin: Cadence" \
  --body "$(cat <<'EOF'
## I am submitting a new Community Plugin

### Repo URL
https://github.com/wesswart77/obsidian-cadence

### Release
https://github.com/wesswart77/obsidian-cadence/releases/tag/0.13.0

### Description
A unified workspace plugin: Home command centre, CRM, PRM, Planner with reminders, rich Project Management, Reports. All on top of plain markdown — no server, no sync service.

### Confirmation
- [x] I have read the [developer policies](https://docs.obsidian.md/Developer+policies) and the [submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin).
- [x] My plugin's `manifest.json` is in the root of the repo.
- [x] My GitHub release is tagged `0.13.0` (matches `manifest.json` version exactly, no `v` prefix).
- [x] `main.js`, `manifest.json`, and `styles.css` are uploaded as release assets.
- [x] I have tested the plugin on the latest Obsidian version.
- [x] My plugin does not include "obsidian" in its name or id.
EOF
)"
```

## Step 6 — Wait for the bot, then humans

- The **`obsidian-bot`** runs automated checks within minutes. If it flags anything, fix in your repo (push a new tag if needed) and comment on the PR.
- A **human reviewer** picks it up over the next 1–4 weeks. They may request changes — common asks:
  - Description rewording (no "obsidian" mentions, no marketing-y language for a separate product)
  - Use Obsidian's `Modal` instead of `confirm()` for destructive actions (currently we use `confirm()` for project/entity delete)
  - Use `requestUrl` for any HTTP (we don't make any yet)
- Push fixes by editing your repo, creating a new release tag (e.g. `0.11.5`), and comment on the PR with the new release link.

## After approval

- Your plugin appears in Settings → Community plugins → Browse.
- For future updates: bump `version` in `manifest.json`, add `"<new-version>": "<min-app-version>"` to `versions.json`, commit, push, `gh release create <new-version> main.js manifest.json styles.css --title "<new-version>"`. The store auto-detects new releases — no PR needed for updates.

## If a reviewer asks for changes

Common ones:

1. **`window.confirm()` for delete** — replace with a Cadence-styled `Modal` showing `Cancel` / `Delete`. Keep `confirm()` calls in two places:
   - `renderEntityDetail` delete button
   - `_renderMilestoneSection` and `_renderTaskSection` delete buttons
   - Inbox row delete button

2. **Idle timers on unload** — wrap `setTimeout`s in the views with cleanup. Most are short-debounced auto-saves; safe in practice but might get flagged.

3. **Settings descriptions** — they may want shorter / less marketing-y copy in the manifest description.

I'll iterate on whatever the reviewers raise.
