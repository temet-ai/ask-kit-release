# What __NAME__ stores and sends

<!-- Write this with the first feature that stores or sends anything, and change it in the
     same commit as the code. Say "no telemetry" only when it is true. -->

<!-- Reference, not reassurance: one plain sentence per fact, no stacked "never"/"only". -->

## What it sends, and where

| To | What | When |
|---|---|---|
| | | |
| Nothing else | | |

## What it writes, and where

| Folder | What | Moved by |
|---|---|---|
| `~/.config/__NAME__/` | `config.toml` (mode 0600) | `XDG_CONFIG_HOME` |
| `~/.local/state/__NAME__/` | log (tokens are never written to it), cache | `XDG_STATE_HOME` |
| `~/.cache/__NAME__/` (`~/Library/Caches/__NAME__` on the Mac) | | `XDG_CACHE_HOME` |

## Removing it

<!-- The uninstall command for each channel, and which folders to delete to remove all data. -->
