#!/bin/bash
# Torm Install Script for macOS and Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/realAndi/torm/main/scripts/install.sh | bash

set -e

REPO="realAndi/torm"
INSTALL_DIR="${TORM_INSTALL:-$HOME/.local/bin}"
BINARY_NAME="torm"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() {
    printf "${BLUE}[INFO]${NC} %s\n" "$1"
}

success() {
    printf "${GREEN}[OK]${NC} %s\n" "$1"
}

warn() {
    printf "${YELLOW}[WARN]${NC} %s\n" "$1"
}

error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1"
    exit 1
}

# Detect OS and architecture
detect_platform() {
    local os arch

    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        Darwin)
            os="darwin"
            ;;
        Linux)
            os="linux"
            ;;
        *)
            error "Unsupported operating system: $os"
            ;;
    esac

    case "$arch" in
        x86_64|amd64)
            arch="x64"
            ;;
        aarch64|arm64)
            arch="arm64"
            ;;
        *)
            error "Unsupported architecture: $arch"
            ;;
    esac

    echo "${os}-${arch}"
}

# Get the latest release version from GitHub
get_latest_version() {
    local version
    version=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

    if [ -z "$version" ]; then
        error "Failed to get latest version"
    fi

    # Remove 'v' prefix if present
    echo "${version#v}"
}

# Download and install
install() {
    local platform version download_url temp_file

    info "Detecting platform..."
    platform=$(detect_platform)
    success "Platform: $platform"

    info "Getting latest version..."
    version=$(get_latest_version)
    success "Version: $version"

    download_url="https://github.com/${REPO}/releases/download/v${version}/torm-${version}-${platform}"
    info "Downloading from: $download_url"

    # Create temp file
    temp_file=$(mktemp)
    trap "rm -f '$temp_file'" EXIT

    # Download
    if ! curl -fsSL "$download_url" -o "$temp_file"; then
        error "Failed to download torm. Please check if the release exists for your platform."
    fi

    # Create install directory
    mkdir -p "$INSTALL_DIR"

    # Install binary
    mv "$temp_file" "${INSTALL_DIR}/${BINARY_NAME}"
    chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

    success "Installed torm to ${INSTALL_DIR}/${BINARY_NAME}"

    # Check if install dir is in PATH
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        warn "$INSTALL_DIR is not in your PATH"
        echo ""
        echo "Add the following to your shell config (~/.bashrc, ~/.zshrc, etc.):"
        echo ""
        echo "  export PATH=\"\$PATH:$INSTALL_DIR\""
        echo ""
    fi

    # Verify installation
    if command -v torm &> /dev/null; then
        echo ""
        success "Installation complete! Run 'torm' to get started."
        torm --version
    else
        echo ""
        success "Installation complete!"
        echo "Run '${INSTALL_DIR}/${BINARY_NAME}' to get started, or add $INSTALL_DIR to your PATH."
    fi
}

# Show help
show_help() {
    cat << EOF
Torm Installer

USAGE:
    install.sh [OPTIONS]

OPTIONS:
    -h, --help      Show this help message
    -d, --dir DIR   Install to custom directory (default: ~/.local/bin)

ENVIRONMENT VARIABLES:
    TORM_INSTALL    Custom install directory

EXAMPLES:
    # Install to default location
    curl -fsSL https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh | bash

    # Install to custom directory
    curl -fsSL https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh | TORM_INSTALL=/usr/local/bin bash

    # Or download and run manually
    ./install.sh --dir /opt/bin
EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -d|--dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
done

# Print banner
echo ""
echo "  ████████╗ ██████╗ ██████╗ ███╗   ███╗"
echo "  ╚══██╔══╝██╔═══██╗██╔══██╗████╗ ████║"
echo "     ██║   ██║   ██║██████╔╝██╔████╔██║"
echo "     ██║   ██║   ██║██╔══██╗██║╚██╔╝██║"
echo "     ██║   ╚██████╔╝██║  ██║██║ ╚═╝ ██║"
echo "     ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝"
echo ""
echo "  Terminal BitTorrent Client"
echo ""

install
