# Torm — Project Plan

## Overview

Torm is a terminal-based BitTorrent client built with TypeScript and Ink (React for CLI). This document outlines the implementation strategy, technology choices, and phased development approach.

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Language | TypeScript | Type safety, excellent tooling, Ink compatibility |
| Runtime | Node.js | Required for Ink, good networking primitives |
| CLI Framework | Ink | React-based CLI with component model, ideal for interactive UI |
| Package Manager | pnpm | Fast, disk-efficient, strict dependency resolution |
| Testing | Vitest | Fast, TypeScript-native, compatible with ESM |
| Build | tsup | Simple, fast bundler for TypeScript CLIs |

## Project Structure

```
torm/
├── src/
│   ├── engine/                 # Core Torrent Engine (zero UI dependencies)
│   │   ├── index.ts            # Engine public API
│   │   ├── types.ts            # Shared types and interfaces
│   │   ├── events.ts           # Event emitter and event types
│   │   ├── torrent/
│   │   │   ├── lifecycle.ts    # Torrent lifecycle manager
│   │   │   ├── metadata.ts     # Torrent/magnet parsing
│   │   │   └── state.ts        # Per-torrent state
│   │   ├── tracker/
│   │   │   ├── client.ts       # Tracker client coordinator
│   │   │   ├── http.ts         # HTTP tracker implementation
│   │   │   └── udp.ts          # UDP tracker implementation
│   │   ├── peer/
│   │   │   ├── manager.ts      # Peer connection manager
│   │   │   ├── connection.ts   # Individual peer connection
│   │   │   ├── protocol.ts     # BitTorrent wire protocol
│   │   │   └── messages.ts     # Protocol message types
│   │   ├── piece/
│   │   │   ├── manager.ts      # Piece selection and tracking
│   │   │   ├── selector.ts     # Piece selection strategies
│   │   │   └── verifier.ts     # Hash verification
│   │   ├── disk/
│   │   │   ├── manager.ts      # Disk I/O coordinator
│   │   │   ├── writer.ts       # Piece writer
│   │   │   └── reader.ts       # Piece reader (for seeding)
│   │   └── config/
│   │       ├── manager.ts      # Configuration management
│   │       └── defaults.ts     # Default settings
│   │
│   ├── cli/                    # CLI Layer
│   │   ├── index.tsx           # CLI entry point
│   │   ├── commands/           # Command mode handlers
│   │   │   ├── add.tsx         # Add torrent/magnet
│   │   │   ├── list.tsx        # List torrents
│   │   │   ├── remove.tsx      # Remove torrent
│   │   │   ├── pause.tsx       # Pause torrent
│   │   │   ├── resume.tsx      # Resume torrent
│   │   │   └── info.tsx        # Show torrent details
│   │   └── utils/
│   │       ├── output.ts       # Formatted output helpers
│   │       └── args.ts         # Argument parsing
│   │
│   ├── ui/                     # Interactive Terminal UI
│   │   ├── App.tsx             # Root UI component
│   │   ├── hooks/
│   │   │   ├── useEngine.ts    # Engine state subscription
│   │   │   ├── useTorrents.ts  # Torrent list state
│   │   │   └── useKeyboard.ts  # Keyboard input handling
│   │   ├── components/
│   │   │   ├── TorrentList.tsx # Main torrent table
│   │   │   ├── TorrentRow.tsx  # Individual torrent row
│   │   │   ├── ProgressBar.tsx # Download progress visualization
│   │   │   ├── StatusBar.tsx   # Bottom status bar
│   │   │   ├── Header.tsx      # Top header/title
│   │   │   ├── Tabs.tsx        # Tab navigation
│   │   │   ├── PeerList.tsx    # Peer details view
│   │   │   ├── FileList.tsx    # File tree view
│   │   │   └── LogView.tsx     # Activity log
│   │   ├── views/
│   │   │   ├── MainView.tsx    # Default torrent list view
│   │   │   ├── DetailView.tsx  # Single torrent details
│   │   │   └── SettingsView.tsx# Configuration view
│   │   └── theme/
│   │       ├── colors.ts       # Color scheme
│   │       └── styles.ts       # Shared styles
│   │
│   └── shared/                 # Shared utilities
│       ├── constants.ts        # Global constants
│       ├── paths.ts            # Data directory paths
│       └── logger.ts           # Logging utility
│
├── bin/
│   └── torm.js                 # Executable entry point
│
├── tests/
│   ├── engine/                 # Engine unit tests
│   ├── cli/                    # CLI integration tests
│   └── fixtures/               # Test torrent files
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Architecture Boundaries

### Engine Layer (src/engine/)
- **Zero dependencies** on Ink, React, or any UI library
- Exposes a clean API via `TormEngine` class
- Communicates state changes via typed EventEmitter
- Can be used standalone (for testing, future daemon mode, or library usage)

### CLI Layer (src/cli/)
- Thin routing layer using Ink
- Parses arguments and routes to either:
  - Command mode: Execute, print, exit
  - Interactive mode: Launch UI
- Commands are simple Ink components that call engine methods

### UI Layer (src/ui/)
- Pure React/Ink components
- Subscribes to engine events via custom hooks
- Never mutates engine state directly
- Sends user intent to engine via method calls

## Implementation Phases

### Phase 1: Foundation
Establish project infrastructure and core engine skeleton.

- Project setup (TypeScript, pnpm, tsup, Vitest)
- Engine class skeleton with event system
- Basic types and interfaces
- Bencode parser (for .torrent files)
- Torrent metadata parsing
- Configuration and data directory management

### Phase 2: Core Engine - Tracker Communication
Implement tracker discovery to find peers.

- HTTP tracker client
- UDP tracker client
- Announce and scrape support
- Peer discovery integration

### Phase 3: Core Engine - Peer Protocol
Implement the BitTorrent peer wire protocol.

- TCP connection management
- Protocol handshake
- Message parsing (choke, unchoke, interested, have, bitfield, request, piece, cancel)
- Peer state machine

### Phase 4: Core Engine - Piece Management
Handle piece selection, downloading, and verification.

- Piece availability tracking
- Piece selection strategies (rarest first, sequential)
- Request pipelining
- SHA-1 hash verification
- Piece completion events

### Phase 5: Core Engine - Disk I/O
Implement persistent storage.

- File allocation
- Piece-to-file mapping
- Safe write operations
- Resume data persistence
- Torrent state serialization

### Phase 6: CLI - Command Mode
Build non-interactive commands.

- Argument parsing setup
- `torm add <magnet|file>` - Add torrent
- `torm list` - List all torrents
- `torm info <id>` - Show torrent details
- `torm pause <id>` - Pause torrent
- `torm resume <id>` - Resume torrent
- `torm remove <id>` - Remove torrent

### Phase 7: Interactive UI - Core Views
Build the main interactive interface.

- App shell with keyboard navigation
- Torrent list table view
- Progress bars and speed display
- Status bar with global stats
- Basic keyboard shortcuts (q=quit, p=pause, r=resume, d=delete)

### Phase 8: Interactive UI - Detail Views
Add detailed torrent information.

- Tab-based navigation
- Peer list view
- File list view
- Tracker list view
- Log/activity view

### Phase 9: Polish and Features
Complete the user experience.

- Magnet link handling improvements
- Sequential download mode
- Upload/seed support
- Rate limiting
- Better error handling and display
- Help and keyboard shortcut overlay

### Phase 10: Distribution
Prepare for release.

- npm package configuration
- Global installation support
- README and documentation
- GitHub Actions CI
- Release workflow

## Key Design Decisions

### Event System
The engine uses a typed EventEmitter pattern:

```
Events:
- torrent:added      - New torrent added
- torrent:started    - Torrent started downloading
- torrent:paused     - Torrent paused
- torrent:completed  - Download finished
- torrent:removed    - Torrent removed
- torrent:error      - Error occurred
- torrent:progress   - Progress update (throttled)
- peer:connected     - Peer connected
- peer:disconnected  - Peer disconnected
- tracker:announce   - Tracker announce result
```

### State Management
- Engine maintains authoritative state
- UI derives view state from engine events
- No bidirectional state sync; UI is read-only observer

### Torrent Identification
- Each torrent has a unique info hash (20-byte SHA-1)
- UI displays shortened versions for usability
- Commands accept partial hashes or numeric indices

### Data Directory
Default location: `~/.torm/`
```
~/.torm/
├── config.json       # User configuration
├── torrents/         # Torrent metadata
├── resume/           # Resume data
└── downloads/        # Default download location
```

## Dependencies (Planned)

### Production
- `ink` - React for CLI
- `react` - Required by Ink
- `meow` or `yargs` - Argument parsing
- `bencode` - Torrent file parsing
- `node:crypto` - SHA-1 hashing
- `node:net` - TCP connections
- `node:dgram` - UDP tracker communication

### Development
- `typescript`
- `tsup` - Build tool
- `vitest` - Testing
- `@types/react`
- `eslint` + `prettier`

## Success Criteria

Each phase is complete when:
1. All planned features are implemented
2. Unit tests pass
3. No TypeScript errors
4. The engine remains UI-independent (verifiable by import analysis)
5. Interactive and command modes both function correctly

## Future Considerations (Out of Scope for Initial Release)

- DHT (Distributed Hash Table) for trackerless torrents
- PEX (Peer Exchange)
- Encryption (MSE/PE)
- Web UI
- Daemon mode with IPC
- Torrent creation
- RSS feed support
