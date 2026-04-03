// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Metro configuration for Cogni mobile app.
 *
 * Handles pnpm workspace symlink resolution so that workspace packages
 * (@cogni/node-contracts, @cogni/node-core, etc.) resolve correctly
 * through Metro's module resolution.
 */

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the entire monorepo so workspace package changes trigger rebuilds
config.watchFolders = [monorepoRoot];

// pnpm uses symlinks — tell Metro where to resolve node_modules from
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Enable package.json "exports" field resolution (required for workspace packages
// that use subpath exports like @cogni/node-contracts)
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
