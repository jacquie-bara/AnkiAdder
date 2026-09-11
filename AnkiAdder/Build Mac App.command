#!/bin/bash
set -euo pipefail

cd -- "$(dirname -- "$0")"

echo "========================================"
echo "          AnkiAdder Mac Builder"
echo "========================================"
echo

# Make common Homebrew paths available.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# ------------------------------------------------------------
# Check macOS
# ------------------------------------------------------------

if [ "$(uname -s)" != "Darwin" ]; then
    echo "ERROR: This build script must be run on macOS."
    echo
    read -r -p "Press Return to close."
    exit 1
fi

# ------------------------------------------------------------
# Load nvm if already installed
# ------------------------------------------------------------

export NVM_DIR="$HOME/.nvm"

if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh"
fi

# ------------------------------------------------------------
# Install nvm if necessary
# ------------------------------------------------------------

install_nvm() {
    echo
    echo "Node.js 24 is required."
    echo "Installing nvm..."
    echo

    if ! command -v curl >/dev/null 2>&1; then
        echo "ERROR: curl is required to install Node.js."
        echo
        read -r -p "Press Return to close."
        exit 1
    fi

    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

    export NVM_DIR="$HOME/.nvm"

    if [ -s "$NVM_DIR/nvm.sh" ]; then
        . "$NVM_DIR/nvm.sh"
    else
        echo
        echo "ERROR: nvm installation failed."
        echo
        read -r -p "Press Return to close."
        exit 1
    fi
}

# ------------------------------------------------------------
# Check current Node version
# ------------------------------------------------------------

NEED_NEW_NODE=false

if ! command -v node >/dev/null 2>&1; then
    NEED_NEW_NODE=true
else
    NODE_VERSION="$(node -p 'process.versions.node')"
    NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
    NODE_MINOR="$(node -p 'Number(process.versions.node.split(".")[1])')"

    echo "Current Node.js version: v$NODE_VERSION"

    if [ "$NODE_MAJOR" -lt 22 ]; then
        NEED_NEW_NODE=true
    elif [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; then
        NEED_NEW_NODE=true
    fi
fi

# ------------------------------------------------------------
# Automatically install Node.js 24 if needed
# ------------------------------------------------------------

if [ "$NEED_NEW_NODE" = true ]; then
    echo
    echo "Your Node.js version is missing or too old."
    echo "AnkiAdder requires Node.js 22.12 or newer."
    echo
    echo "Node.js 24 will now be installed automatically."

    if ! command -v nvm >/dev/null 2>&1; then
        install_nvm
    fi

    echo
    echo "Installing Node.js 24..."
    echo

    nvm install 24

    echo
    echo "Switching to Node.js 24..."
    nvm use 24

    # Make Node 24 the default for future terminal sessions.
    nvm alias default 24

    echo
fi

# ------------------------------------------------------------
# Final verification
# ------------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: Node.js could not be found after installation."
    echo
    read -r -p "Press Return to close."
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm could not be found after installation."
    echo
    read -r -p "Press Return to close."
    exit 1
fi

NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
NODE_MINOR="$(node -p 'Number(process.versions.node.split(".")[1])')"

if [ "$NODE_MAJOR" -lt 22 ] || \
   { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; }; then

    echo
    echo "ERROR: Node.js is still too old."
    echo "Current version: v$NODE_VERSION"
    echo "Required: Node.js 22.12 or newer."
    echo
    read -r -p "Press Return to close."
    exit 1
fi

echo "Node.js version: v$NODE_VERSION"
echo "npm version:     $(npm -v)"
echo
echo "Node.js version is supported."
echo

# ------------------------------------------------------------
# Clean old dependencies
# ------------------------------------------------------------

if [ -d "node_modules" ]; then
    echo "Removing old node_modules..."
    rm -rf node_modules
    echo
fi

# ------------------------------------------------------------
# Install dependencies
# ------------------------------------------------------------

echo "Installing AnkiAdder dependencies..."
echo

npm ci

# ------------------------------------------------------------
# Build application
# ------------------------------------------------------------

echo
echo "Building AnkiAdder for macOS..."
echo

CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac -- --publish never

# ------------------------------------------------------------
# Finished
# ------------------------------------------------------------

echo
echo "========================================"
echo "             Build complete"
echo "========================================"
echo

if [ -d "release" ]; then
    echo "Opening release folder..."
    open release
else
    echo "WARNING: release folder was not found."
fi

echo
echo "Open the DMG and drag AnkiAdder to Applications."
echo

read -r -p "Press Return to close."