# Torm — Implementation TODO

## Phase 1: Foundation

### Project Setup
- [ ] Initialize pnpm project with `pnpm init`
- [ ] Configure TypeScript (`tsconfig.json`)
- [ ] Configure tsup for building (`tsup.config.ts`)
- [ ] Configure Vitest for testing (`vitest.config.ts`)
- [ ] Set up ESLint and Prettier
- [ ] Create directory structure as defined in PLAN.md
- [ ] Add bin entry point (`bin/torm.js`)
- [ ] Install core dependencies (ink, react, typescript)

### Engine Skeleton
- [ ] Define core types (`src/engine/types.ts`)
  - [ ] `TorrentState` enum (queued, checking, downloading, seeding, paused, error)
  - [ ] `Torrent` interface (info hash, name, progress, speeds, peers, state)
  - [ ] `Peer` interface (ip, port, client, upload/download speeds)
  - [ ] `TrackerInfo` interface (url, status, peers, last announce)
  - [ ] `EngineConfig` interface
- [ ] Define events (`src/engine/events.ts`)
  - [ ] `TormEvents` type map
  - [ ] Typed event emitter wrapper
- [ ] Create `TormEngine` class (`src/engine/index.ts`)
  - [ ] Constructor with config
  - [ ] Event subscription methods
  - [ ] Placeholder public API methods

### Bencode Parser
- [ ] Implement or integrate bencode decode
- [ ] Implement or integrate bencode encode
- [ ] Add tests for bencode parsing

### Torrent Metadata
- [ ] Parse .torrent file structure (`src/engine/torrent/metadata.ts`)
  - [ ] Extract info hash
  - [ ] Parse announce URLs
  - [ ] Parse file information (single and multi-file)
  - [ ] Parse piece length and pieces
- [ ] Parse magnet links
  - [ ] Extract info hash from magnet URI
  - [ ] Extract display name
  - [ ] Extract tracker URLs
- [ ] Add tests for metadata parsing

### Configuration
- [ ] Define default config (`src/engine/config/defaults.ts`)
- [ ] Implement config manager (`src/engine/config/manager.ts`)
  - [ ] Load from disk
  - [ ] Save to disk
  - [ ] Merge with defaults
- [ ] Define data directory paths (`src/shared/paths.ts`)
  - [ ] Get config path
  - [ ] Get torrents path
  - [ ] Get downloads path
  - [ ] Ensure directories exist

---

## Phase 2: Tracker Communication

### HTTP Tracker
- [ ] Implement HTTP tracker client (`src/engine/tracker/http.ts`)
  - [ ] Build announce URL with query parameters
  - [ ] Parse compact peer list
  - [ ] Parse dictionary peer list
  - [ ] Handle tracker errors
  - [ ] Support scrape requests
- [ ] Add tests with mock HTTP server

### UDP Tracker
- [ ] Implement UDP tracker client (`src/engine/tracker/udp.ts`)
  - [ ] Connection request/response
  - [ ] Announce request/response
  - [ ] Handle timeouts and retries
  - [ ] Parse compact peer response
- [ ] Add tests with mock UDP server

### Tracker Coordinator
- [ ] Implement tracker client (`src/engine/tracker/client.ts`)
  - [ ] Manage multiple trackers per torrent
  - [ ] Handle announce intervals
  - [ ] Aggregate peer results
  - [ ] Emit tracker events
- [ ] Add tests for coordinator logic

---

## Phase 3: Peer Protocol

### Connection Management
- [ ] Implement peer connection (`src/engine/peer/connection.ts`)
  - [ ] TCP socket wrapper
  - [ ] Connection timeout handling
  - [ ] Reconnection logic
  - [ ] Clean disconnection

### Protocol Implementation
- [ ] Define message types (`src/engine/peer/messages.ts`)
  - [ ] Handshake message
  - [ ] Keep-alive
  - [ ] Choke / Unchoke
  - [ ] Interested / Not Interested
  - [ ] Have
  - [ ] Bitfield
  - [ ] Request
  - [ ] Piece
  - [ ] Cancel
- [ ] Implement wire protocol (`src/engine/peer/protocol.ts`)
  - [ ] Message serialization
  - [ ] Message deserialization
  - [ ] Stream-based message parsing
- [ ] Add protocol tests

### Peer Manager
- [ ] Implement peer manager (`src/engine/peer/manager.ts`)
  - [ ] Track active connections
  - [ ] Limit concurrent connections
  - [ ] Handle choke/unchoke strategy
  - [ ] Emit peer events
  - [ ] Calculate per-peer speeds
- [ ] Add peer manager tests

---

## Phase 4: Piece Management

### Piece Tracking
- [ ] Implement piece manager (`src/engine/piece/manager.ts`)
  - [ ] Track piece states (missing, requested, downloaded, verified)
  - [ ] Track piece availability across peers
  - [ ] Handle piece completion
  - [ ] Calculate overall progress

### Piece Selection
- [ ] Implement piece selector (`src/engine/piece/selector.ts`)
  - [ ] Rarest-first strategy
  - [ ] Random first piece (for initial speed)
  - [ ] Sequential mode option
  - [ ] Endgame mode

### Verification
- [ ] Implement piece verifier (`src/engine/piece/verifier.ts`)
  - [ ] SHA-1 hash comparison
  - [ ] Async verification queue
  - [ ] Handle corrupt pieces
- [ ] Add piece management tests

---

## Phase 5: Disk I/O

### File Mapping
- [ ] Implement disk manager (`src/engine/disk/manager.ts`)
  - [ ] Map pieces to file offsets
  - [ ] Handle multi-file torrents
  - [ ] Allocate files on disk

### Writing
- [ ] Implement piece writer (`src/engine/disk/writer.ts`)
  - [ ] Write piece data to correct file positions
  - [ ] Handle pieces spanning multiple files
  - [ ] Atomic write operations

### Reading
- [ ] Implement piece reader (`src/engine/disk/reader.ts`)
  - [ ] Read pieces for seeding
  - [ ] Handle read errors

### Resume Data
- [ ] Implement resume data persistence
  - [ ] Save bitfield of completed pieces
  - [ ] Save torrent state
  - [ ] Load on startup
- [ ] Add disk I/O tests

---

## Phase 6: CLI - Command Mode

### Setup
- [ ] Set up argument parsing with meow or yargs
- [ ] Create CLI entry point (`src/cli/index.tsx`)
- [ ] Implement command routing

### Commands
- [ ] Implement `add` command (`src/cli/commands/add.tsx`)
  - [ ] Accept magnet links
  - [ ] Accept .torrent file paths
  - [ ] Display added torrent info
- [ ] Implement `list` command (`src/cli/commands/list.tsx`)
  - [ ] Table output with progress, speed, status
  - [ ] Colorized status indicators
- [ ] Implement `info` command (`src/cli/commands/info.tsx`)
  - [ ] Detailed torrent information
  - [ ] File list
  - [ ] Tracker list
- [ ] Implement `pause` command (`src/cli/commands/pause.tsx`)
- [ ] Implement `resume` command (`src/cli/commands/resume.tsx`)
- [ ] Implement `remove` command (`src/cli/commands/remove.tsx`)
  - [ ] Option to delete files
  - [ ] Confirmation prompt

### Output Utilities
- [ ] Create output helpers (`src/cli/utils/output.ts`)
  - [ ] Format bytes (KB, MB, GB)
  - [ ] Format speeds (KB/s, MB/s)
  - [ ] Format time remaining
  - [ ] Format progress percentage

---

## Phase 7: Interactive UI - Core Views

### App Shell
- [ ] Create App component (`src/ui/App.tsx`)
  - [ ] Full-screen layout
  - [ ] Keyboard event handling
  - [ ] View switching
- [ ] Create useEngine hook (`src/ui/hooks/useEngine.ts`)
  - [ ] Subscribe to engine events
  - [ ] Provide torrent state to components
- [ ] Create useKeyboard hook (`src/ui/hooks/useKeyboard.ts`)
  - [ ] Global keyboard shortcuts
  - [ ] Context-aware key handling

### Core Components
- [ ] Create Header component (`src/ui/components/Header.tsx`)
  - [ ] App title
  - [ ] Global stats (total up/down speed)
- [ ] Create TorrentList component (`src/ui/components/TorrentList.tsx`)
  - [ ] Scrollable list
  - [ ] Selection highlighting
  - [ ] Column layout (name, size, progress, speed, status)
- [ ] Create TorrentRow component (`src/ui/components/TorrentRow.tsx`)
  - [ ] Compact torrent info display
  - [ ] Status-based coloring
- [ ] Create ProgressBar component (`src/ui/components/ProgressBar.tsx`)
  - [ ] Visual progress indicator
  - [ ] Percentage display
- [ ] Create StatusBar component (`src/ui/components/StatusBar.tsx`)
  - [ ] Keyboard shortcut hints
  - [ ] Selected torrent info

### Main View
- [ ] Create MainView (`src/ui/views/MainView.tsx`)
  - [ ] Compose header, list, status bar
  - [ ] Handle list navigation
  - [ ] Handle torrent actions

---

## Phase 8: Interactive UI - Detail Views

### Tab Navigation
- [ ] Create Tabs component (`src/ui/components/Tabs.tsx`)
  - [ ] Tab switching
  - [ ] Active tab indicator

### Detail View
- [ ] Create DetailView (`src/ui/views/DetailView.tsx`)
  - [ ] Tab container
  - [ ] Back navigation

### Detail Tabs
- [ ] Create PeerList component (`src/ui/components/PeerList.tsx`)
  - [ ] Peer table (IP, client, speed, progress)
  - [ ] Connection status
- [ ] Create FileList component (`src/ui/components/FileList.tsx`)
  - [ ] File tree display
  - [ ] Per-file progress
  - [ ] File size
- [ ] Create TrackerList component (extend existing)
  - [ ] Tracker status
  - [ ] Peer count
  - [ ] Last announce time
- [ ] Create LogView component (`src/ui/components/LogView.tsx`)
  - [ ] Activity log
  - [ ] Scrollable history

---

## Phase 9: Polish and Features

### Improvements
- [ ] Add sequential download mode toggle
- [ ] Implement upload/seeding after completion
- [ ] Add rate limiting (config + runtime)
- [ ] Improve error messages and display
- [ ] Add torrent labeling/categories
- [ ] Add search/filter for torrent list

### UX Enhancements
- [ ] Add help overlay (? key)
- [ ] Add confirmation dialogs
- [ ] Add notifications for completed downloads
- [ ] Improve keyboard navigation
- [ ] Add mouse support (if Ink supports)

### Robustness
- [ ] Handle network errors gracefully
- [ ] Add reconnection logic
- [ ] Handle disk full errors
- [ ] Add graceful shutdown
- [ ] Save state on exit

---

## Phase 10: Distribution

### Package Configuration
- [ ] Configure package.json for npm publishing
  - [ ] Set bin field
  - [ ] Set files field
  - [ ] Add keywords
  - [ ] Write description
- [ ] Test global installation (`npm install -g`)
- [ ] Test npx usage

### Documentation
- [ ] Write comprehensive README.md
  - [ ] Installation instructions
  - [ ] Usage examples
  - [ ] Screenshots/GIFs
  - [ ] Command reference
  - [ ] Keyboard shortcuts
- [ ] Add CONTRIBUTING.md
- [ ] Add CHANGELOG.md

### CI/CD
- [ ] Set up GitHub Actions
  - [ ] Run tests on PR
  - [ ] Run linting
  - [ ] Build check
- [ ] Set up release workflow
  - [ ] Automated npm publish
  - [ ] GitHub releases
  - [ ] Changelog generation

---

## Stretch Goals (Post-1.0)

- [ ] DHT support for trackerless torrents
- [ ] PEX (Peer Exchange)
- [ ] Protocol encryption (MSE/PE)
- [ ] Web UI mode
- [ ] Daemon mode with IPC
- [ ] Torrent creation
- [ ] RSS feed support
- [ ] Bandwidth scheduling
- [ ] IP filtering
