# Delivery Checklist

Use this checklist before handing the source to a buyer or developer. It separates maintainer actions from recipient actions and does not grant legal rights.

## Maintainer before delivery

- [ ] Review the documentation in `README.md` and `docs/`.
- [ ] Confirm the intended project license decision is recorded separately; the current repository has no project `LICENSE` file.
- [ ] Confirm real `.env` files and `config/model-config.local.json` are not tracked.
- [ ] Confirm no model binaries, logs, runtime state, environments, database dumps, or user data are tracked.
- [ ] Confirm `database/schema.sql` still describes the seven-table baseline.
- [ ] Run the non-destructive validation suite:

```powershell
.\scripts\test-hardware-profiles.ps1
.\scripts\test-model-config.ps1
npm.cmd run build
npm.cmd run lint
node scripts/check-database.js
.\setup-all.cmd -CheckOnly -Profile auto
.\check-models.cmd -Profile auto
```

- [ ] Stop project-owned services before packaging:

```powershell
.\stop-all.cmd
```

- [ ] Commit the reviewed Batch 4.6 documentation changes yourself.
- [ ] Ensure the intended branch is merged to `main` and `main` is clean.
- [ ] Run the production source package command from the clean committed repository:

```powershell
.\package-source.cmd
```

- [ ] Record the generated ZIP filename and SHA-256 checksum.
- [ ] Confirm the package reports extracted validation and forbidden-file scan success.
- [ ] Extract the ZIP into a temporary location and verify the single top-level `AI-English-Friend/` directory.
- [ ] Deliver the ZIP together with its `.sha256` checksum and the separately decided project/commercial terms.

## Recipient after delivery

- [ ] Verify the ZIP checksum before extraction.
- [ ] Extract the source package to a working directory.
- [ ] Install the prerequisites listed in [BUYER_GUIDE.md](BUYER_GUIDE.md).
- [ ] Run `.\setup-all.cmd -CheckOnly -Profile auto`.
- [ ] Run `.\setup-all.cmd -Profile auto` and review generated local `.env` files.
- [ ] Configure MySQL in the ignored `server/.env`.
- [ ] Run `.\check-models.cmd -Profile auto`.
- [ ] Start with `.\start-all.cmd -Profile auto`.
- [ ] Confirm `.\status.cmd` and open `http://127.0.0.1:5173/`.
- [ ] Stop with `.\stop-all.cmd`.

## Delivery exclusions

The source package does not include `.git/`, real secrets, local overrides, `node_modules`, Python virtual environments, logs, runtime metadata, user data, database dumps, or external model binaries/assets. A recipient must obtain and configure those external prerequisites independently.

## Important repository distinction

The package command is a source-maintainer workflow because it relies on Git metadata and a clean tracked tree. A buyer may develop and run the extracted source without Git, but should not expect `package-source.cmd` to work until the source is placed in a Git repository.
