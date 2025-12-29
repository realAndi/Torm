# Contributing to Torm

Thank you for your interest in contributing to Torm. This document provides guidelines and information for contributors.

## Code of Conduct

Be respectful and constructive in all interactions. We aim to maintain a welcoming environment for everyone.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/torm.git
   cd torm
   ```
3. Install dependencies:
   ```bash
   bun install
   ```
4. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

### Running the Project

```bash
# Development mode with hot reload
bun run dev

# Build the project
bun run build

# Run the built version
bun run start
```

### Testing

```bash
# Run tests once
bun run test

# Run tests in watch mode
bun run test:watch
```

### Code Quality

```bash
# Run linter
bun run lint

# Fix linting issues
bun run lint:fix

# Check formatting
bun run format:check

# Format code
bun run format
```

## Architecture

Torm follows a strict separation between its three layers:

### Engine Layer (`src/engine/`)

- Core BitTorrent protocol implementation
- Tracker communication (HTTP and UDP)
- Peer connection management
- Piece selection and verification
- Disk I/O operations
- **No UI dependencies** - this layer must not import from `src/ui/` or `src/cli/`

### CLI Layer (`src/cli/`)

- Command-line argument parsing
- Command routing
- Delegates all torrent operations to the engine
- Thin wrapper that connects user input to engine functionality

### UI Layer (`src/ui/`)

- Interactive terminal interface built with Ink/React
- Subscribes to engine events
- Renders state but does not mutate torrent logic directly
- Components, hooks, views, and themes

### Shared (`src/shared/`)

- Constants, types, and utilities used across layers
- Path utilities for data directories

## Contribution Guidelines

### Pull Requests

1. **One feature per PR**: Keep pull requests focused on a single change
2. **Update tests**: Add or update tests for your changes
3. **Follow existing patterns**: Match the coding style of the existing codebase
4. **Respect layer boundaries**: Do not introduce cross-layer dependencies that violate the architecture
5. **Run checks before submitting**:
   ```bash
   bun run lint
   bun run test
   bun run build
   ```

### Commit Messages

- Use clear, descriptive commit messages
- Start with a verb in present tense (e.g., "Add", "Fix", "Update", "Remove")
- Keep the first line under 72 characters
- Reference issues when applicable (e.g., "Fix #123")

Examples:
```
Add UDP tracker support
Fix piece verification for multi-file torrents
Update peer connection timeout handling
Remove deprecated config options
```

### Code Style

- Use TypeScript for all new code
- Follow the existing ESLint and Prettier configuration
- Prefer explicit types over inference for public APIs
- Use meaningful variable and function names
- Add JSDoc comments for exported functions and complex logic

### Testing

- Write tests for new functionality
- Ensure existing tests pass before submitting
- Place test files in the `tests/` directory
- Use descriptive test names that explain the expected behavior

## Reporting Issues

When reporting bugs:

1. Check if the issue already exists
2. Include your environment (OS, Bun version)
3. Provide steps to reproduce
4. Include relevant error messages or logs
5. Describe expected vs actual behavior

## Feature Requests

Feature requests are welcome. Please:

1. Check if the feature has already been requested
2. Describe the use case and why it would be valuable
3. Consider if it fits within the project's scope and architecture

## License

By contributing to Torm, you agree that your contributions will be licensed under the AGPL-3.0 license.

## Questions

If you have questions about contributing, feel free to open an issue for discussion.
