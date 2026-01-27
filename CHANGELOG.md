# Changelog

## [2.0.0] - 2025-01-26

### Added

- Exported more functions and types that were used internally.
- Webapps now have `windowsFxVersionDefault` and `linuxFxVersionDefault` that only set the value when the corresponding value is unset.
- Upsert tool operations now have tag support.
- Resource group function and tools supports tags.
- New `toCliArgPairs` function which can convert tag POJO objects to AZ CLI argument arrays for `--tags` arguments.

### Fixed

- Use `readonly` on parameters where appropriate.

### Changed

- Assorted dependency updates.
- Reduced AZ CLI usage in most tools where direct SDK calls are safer.
- Renamed some things.
- New and simpler resource group function signatures.

## [1.0.0] - 2025-08-15

_Initial release._
