# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2024-12-29

### Added

- Initial release of Torm
- Interactive terminal user interface (TUI) with full keyboard navigation
- Command-line interface (CLI) for scripting and automation
- Background daemon for persistent downloads
- Support for magnet links and .torrent files
- Drag-and-drop support for adding multiple torrents
- HTTP and UDP tracker support
- Peer connection management with BitTorrent protocol implementation
- Piece selection with rarest-first strategy
- SHA-1 piece verification
- Multi-file torrent support
- Real-time download and upload speed monitoring
- Peer list with client identification and country flags
- Tracker status display
- File list with per-file progress
- Torrent labeling system
- Search and filter functionality in TUI
- Settings modal for configuration
- Help overlay with keyboard shortcuts
- Configurable download paths
- Resume data persistence

### Known Issues

- Torrents may occasionally need to be deleted twice from the list

[Unreleased]: https://github.com/realAndi/torm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/realAndi/torm/releases/tag/v0.1.0
