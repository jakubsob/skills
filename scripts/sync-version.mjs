#!/usr/bin/env node
// Sync the version from package.json into .claude-plugin/plugin.json so the
// two manifests never drift. Run automatically after `changeset version`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const pluginPath = join(root, ".claude-plugin", "plugin.json");

const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));

if (plugin.version === version) {
  console.log(`plugin.json already at ${version}`);
} else {
  const from = plugin.version;
  plugin.version = version;
  writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + "\n");
  console.log(`plugin.json version ${from} -> ${version}`);
}
