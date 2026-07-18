# Verification reference

- Match verification depth to the impact of the change.
- Prefer the repository's own CI or documented command over an invented substitute.
- For generated packages, inspect the archive structure and excluded data, not only the exit code.
- For publication, compare local and remote commit identifiers and verify the release asset is visible.
- State exactly which checks ran and whether they passed.
