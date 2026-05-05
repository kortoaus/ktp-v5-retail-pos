# Electron Auto Update Notes

This note is for the KTPV5 Retail POS Electron app.

## Mental Model

Auto update does not download source code or rebuild on the POS terminal.

The flow is:

```text
Developer builds a new installer
  -> GitHub Release receives installer + latest.yml
  -> Installed POS app checks GitHub Release on boot
  -> If the version is newer, it downloads the installer
  -> App restarts and installs the new version
```

## Current Policy

- The app checks for updates only once on boot.
- It does not poll while the POS is running.
- If an update is found, it downloads automatically.
- Once downloaded, it immediately restarts and installs.
- If update check/download fails, the existing app keeps running.
- Major-version blocking is not implemented yet.

## Normal Code Push

Use this when you only want to push code changes.

This does not create a Release.
This does not update POS terminals.

```bash
git add .
git commit -m "your message"
git push
```

Rule:

```text
No tag push = no POS auto-update release
```

## POS Auto Update Release

Use this when you want installed POS terminals to update.

From the repo root:

```bash
./scripts/release-pos.sh patch
```

For a feature release:

```bash
./scripts/release-pos.sh minor
```

For a major release:

```bash
./scripts/release-pos.sh major
```

The script bumps the POS app version, creates a commit, creates the matching
tag, pushes `main`, and pushes the tag.

Pushing the tag starts GitHub Actions.
The workflow builds the Windows installer and publishes the Release assets.

## Version Commands

Patch release:

```bash
npm version patch
```

Example:

```text
1.0.0 -> 1.0.1
```

Use for fixes and small changes.

Minor release:

```bash
npm version minor
```

Example:

```text
1.0.1 -> 1.1.0
```

Use for feature updates.

Major release:

```bash
npm version major
```

Example:

```text
1.1.0 -> 2.0.0
```

Use only for major/breaking changes.

Important: current updater logic does not block major updates yet. If `2.0.0`
is released, existing `1.x.x` installs can update to it.

## What `npm version` Does

Do not run `npm version` manually for POS releases.

Use:

```bash
./scripts/release-pos.sh patch
```

The script runs `npm version` safely for this repo and then handles the git
commit/tag/push steps explicitly.

The script does all of this:

```text
Updates retail_pos_app/package.json
Updates retail_pos_app/package-lock.json
Creates a git commit
Creates a git tag, such as v1.0.1
Pushes main
Pushes the tag
```

That tag push is what triggers release deployment.

## If You Run `npm version` By Mistake

First check what happened:

```bash
git status
git tag --list "v*"
git log --oneline -3
```

If the tag was not pushed yet, recovery is usually simple.

Example for mistaken `v1.0.1`:

```bash
git tag -d v1.0.1
git reset --soft HEAD~1
```

Then fix the version files or recommit as needed.

Do not assume editing only `package.json` is enough. `package-lock.json`, the
git commit, and the git tag may also have changed.

## If The Tag Was Already Pushed

Treat this as a possible release incident.

The tag push may already have started GitHub Actions and created a Release.

You can delete the remote tag:

```bash
git push origin :refs/tags/v1.0.1
git tag -d v1.0.1
```

But also check:

- whether GitHub Actions already ran
- whether a GitHub Release was created
- whether POS terminals may have seen the update

## GitHub Requirements

For release publishing, GitHub must allow the workflow to write Releases.

Check:

```text
Repo Settings
  -> Actions
  -> General
  -> Workflow permissions
  -> Read and write permissions
```

The current workflow publishes to:

```text
kortoaus/ktp-v5-retail-pos
```

If the updater Release repo is separated later, update the `build.publish.repo`
setting in `retail_pos_app/package.json` and use an appropriate GitHub token.

## Release Assets

For Windows auto update, the Release should include:

```text
KTPV5 Retail Terminal-<version>-setup.exe
KTPV5 Retail Terminal-<version>-setup.exe.blockmap
latest.yml
```

The installed app reads `latest.yml` to decide whether a newer version exists.

## Short Rules

```text
Just push code:
  git push

Release update:
  ./scripts/release-pos.sh patch
  ./scripts/release-pos.sh minor

Do not want release:
  do not push a v* tag

Version must match:
  package.json version 1.0.1
  tag v1.0.1
```
