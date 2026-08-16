// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Application settings on disk (~/.config/aster/config.yaml, honoring
 * XDG_CONFIG_HOME). The schema is a strict whitelist: only paths we own are
 * read or written. Kubeconfig sources are path references — file contents
 * never enter the renderer and are never copied.
 */

export interface AsterSettings {
  kubeconfigSources: string[];
}

export const DEFAULT_SETTINGS: AsterSettings = { kubeconfigSources: [] };

export function settingsFilePath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config");
  return path.join(base, "aster", "config.yaml");
}

const MAX_SOURCES = 64;
const MAX_PATH_LENGTH = 2048;

/** Parses the settings document; unknown keys are dropped, not merged. */
export function parseSettings(document: string): AsterSettings {
  const sources: string[] = [];
  const lines = document.split(/\r?\n/);
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const inline = /^kubeconfigSources:\s*\[(.*)\]\s*$/.exec(trimmed);
    if (inline) {
      if (inline[1].trim() !== "") {
        for (const raw of inline[1].split(",")) {
          const value = unquoteYamlString(raw.trim());
          if (value && value.length <= MAX_PATH_LENGTH && !sources.includes(value)) sources.push(value);
        }
      }
      inList = false;
      continue;
    }
    if (/^kubeconfigSources:\s*$/.test(trimmed)) {
      inList = true;
      continue;
    }
    const item = /^-\s+(.+)$/.exec(trimmed);
    if (item && inList) {
      const value = unquoteYamlString(item[1].trim());
      if (value && value.length <= MAX_PATH_LENGTH && !sources.includes(value)) sources.push(value);
      continue;
    }
    inList = false;
  }
  return { kubeconfigSources: sources.slice(0, MAX_SOURCES) };
}

function unquoteYamlString(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function serializeSettings(settings: AsterSettings): string {
  if (settings.kubeconfigSources.length === 0) return "kubeconfigSources: []\n";
  const lines = ["kubeconfigSources:", ...settings.kubeconfigSources.map((source) => `  - ${JSON.stringify(source)}`)];
  return `${lines.join("\n")}\n`;
}

export interface SettingsFile {
  read(): AsterSettings;
  write(settings: AsterSettings): void;
}

export function createSettingsFile(filePath = settingsFilePath()): SettingsFile {
  return {
    read() {
      try {
        return parseSettings(fs.readFileSync(filePath, "utf8"));
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    },
    write(settings: AsterSettings) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      const target = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp`);
      fs.writeFileSync(target, serializeSettings(settings), { mode: 0o600 });
      fs.renameSync(target, filePath);
    },
  };
}

/** Normalizes an incoming source list from the renderer: strings, capped, deduped. */
export function normalizeSources(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const sources: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value || value.length > MAX_PATH_LENGTH || sources.includes(value)) continue;
    sources.push(value);
  }
  return sources.slice(0, MAX_SOURCES);
}
