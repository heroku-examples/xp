# xp:stop Command

## Overview

The `xp:stop` command allows you to temporarily deactivate an experiment by setting `active: false` in the HEROKU_XP configuration. This stops routing traffic to the experiment without permanently removing it.

## Usage

```bash
heroku xp:stop --app <parent-app> --branch <branch-name>
```

### Required Flags

- `--app, -a` - The parent app name (required)
- `--branch, -b` - The GitHub branch name of the experiment to stop (required)

### Optional Flags

- `--remote, -r` - Git remote to use (optional)

## Examples

### Stop an active experiment

```bash
$ heroku xp:stop --app my-app-staging --branch feature-xyz
Fetching experiment configuration... ✓
Finding experiment for branch "feature-xyz"... ✓ Found: my-app-staging-feature-xyz-a1b2c3
Stopping experiment... ✓

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Experiment stopped successfully!

  Parent App:     my-app-staging
  Branch:         feature-xyz
  Experiment App: my-app-staging-feature-xyz-a1b2c3

The experiment is now inactive and will not receive traffic.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

To reactivate this experiment, run:
  heroku xp:start --app my-app-staging --branch feature-xyz

To permanently remove this experiment, run:
  heroku xp:destroy --app my-app-staging --branch feature-xyz
```

### Stop an already inactive experiment

```bash
$ heroku xp:stop --app my-app-staging --branch feature-xyz
Fetching experiment configuration... ✓
Finding experiment for branch "feature-xyz"... ✓ Found: my-app-staging-feature-xyz-a1b2c3

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ℹ️  Experiment is already inactive

  Parent App:     my-app-staging
  Branch:         feature-xyz
  Experiment App: my-app-staging-feature-xyz-a1b2c3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Behavior

1. **Fetches current configuration**: Reads the HEROKU_XP config variable from the parent app
2. **Finds the experiment**: Looks up the experiment by parentApp + branch (composite key)
3. **Checks current status**: If already inactive, shows info message and exits without changes
4. **Sets active: false**: Updates the experiment entry to set `active: false`
5. **Updates config**: Writes the updated HEROKU_XP config back to Heroku
6. **Provides next steps**: Shows commands to reactivate or permanently destroy

## Key Features

### Preserves All Configuration

When stopping an experiment, ALL configuration is preserved:
- Routing rules (weight, path, query, header, method)
- App metadata (appName, appID, repo, url)
- Timestamps (createdAt, updatedAt)

Only the `active` field is changed to `false`.

### No Confirmation Required

Unlike `xp:destroy`, the `xp:stop` command does not require confirmation because it's a reversible operation. The experiment can be reactivated with `xp:start`.

### Composite Key Matching

Experiments are identified by the combination of:
- Parent app name
- Branch name

This allows multiple experiments with the same branch name on different parent apps.

## Error Handling

### Experiment Not Found

```bash
$ heroku xp:stop --app my-app-staging --branch nonexistent
Error: No experiment found for branch "nonexistent" on app "my-app-staging".
Run 'heroku xp:list --app my-app-staging' to see all experiments.
```

### Invalid JSON

```bash
$ heroku xp:stop --app my-app-staging --branch feature-xyz
Error: Failed to parse HEROKU_XP config: Unexpected token { in JSON at position 10
```

### App Not Found

```bash
$ heroku xp:stop --app nonexistent-app --branch feature-xyz
Error: Failed to read experiment configuration: App not found
```

## Comparison with Other Commands

### xp:stop vs xp:destroy

| Feature | xp:stop | xp:destroy |
|---------|---------|------------|
| Removes from config | ❌ No | ✅ Yes |
| Stops traffic | ✅ Yes | ✅ Yes |
| Reversible | ✅ Yes | ❌ No |
| Requires confirmation | ❌ No | ✅ Yes |
| Preserves config | ✅ Yes | ❌ No |

### xp:stop vs xp:start

`xp:stop` and `xp:start` are complementary commands:
- `xp:stop` sets `active: false`
- `xp:start` sets `active: true`

Both preserve all other configuration.

## Implementation Details

### Config Variable Validation

After updating, the command validates:
1. **Total weight**: Sum of all active experiment weights ≤ 100%
2. **Config size**: Total HEROKU_XP JSON size ≤ 32KB (Heroku limit)

### Auto-migration

If the HEROKU_XP config is in v1 format, it's automatically migrated to v2 format during the read operation.

### Case Sensitivity

Branch name matching is **case-sensitive**:
- `feature-xyz` ≠ `Feature-XYZ`
- `MAIN` ≠ `main`

## See Also

- `heroku xp:create` - Create a new experiment
- `heroku xp:start` - Reactivate a stopped experiment
- `heroku xp:destroy` - Permanently remove an experiment
- `heroku xp:list` - List all experiments
