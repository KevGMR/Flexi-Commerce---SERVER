AddScopedPermissions seed
=========================

Purpose
-------
Scaffolds a safe, reversible migration to grant missing permissions to roles:

- Adds all permissions defined in `server/config/permissions.js` to `Owner` and `Manager` roles (if missing).
- Ensures `Cashier` role has permissions needed to open/close shifts and create expenses per request (adds `create_sale`, `create_expenses`, `view_expenses`, and `manage_finance`).

Safety
------
- The script writes a JSON backup of current role permissions to `server/seeds/backups/` before any changes.
- By default the script runs in dry-run mode and does not modify the DB. Use `--apply` to perform writes.
- Recommended: take a DB snapshot/backup before running the script with `--apply` in staging or production.

Usage
-----
From the `server` directory (or repository root):

Dry run (recommended):

```bash
node seeds/addScopedPermissions.js
```

Apply changes:

```bash
MONGO_URI="<your-staging-mongo-uri>" ADMIN_ID="<admin-user-id>" node seeds/addScopedPermissions.js --apply
```

Notes
-----
- The script creates an audit entry using `services/auditLogger.logRoleChange` when `--apply` is used. Set `ADMIN_ID` to an admin user id to attribute the change; otherwise `adminId` will be null in the audit log.
- The script writes a backup file named like `role_permissions_backup_YYYY-MM-DDTHH-MM-SS-sssZ.json` in `server/seeds/backups/` — keep this for revert/inspection.
- The script intentionally grants `manage_finance` to `Cashier` to enable shift close flows that currently require that permission; review whether this is acceptable in your security model.

Reverting
--------
To revert an applied run, restore role permissions from the corresponding backup JSON file (manual or scripted). The backup contains `before` arrays for each affected role.

Example revert (manual):

1. Open the backup JSON file in `server/seeds/backups/`.
2. For each role, set the `permissions` field back to the `before` array and save the role document.
