/**
 * Project capability and analyzer detector.
 * Discovers available static analysis tools in the target workspace.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectCapabilities } from './types';
import {
  resolveTscExecutable,
  resolveEslintExecutable,
  resolvePyrightExecutable,
} from './envUtils';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.vscode',
  '.venv',
  'venv',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  'target',
  'coverage',
]);

/**
 * Searches for relevant config files within max depth without descending into ignored directories.
 */
function findConfigFiles(dir: string, filenames: string[], maxDepth = 3, currentDepth = 0): string[] {
  if (currentDepth > maxDepth || !fs.existsSync(dir)) {
    return [];
  }

  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          results.push(
            ...findConfigFiles(path.join(dir, entry.name), filenames, maxDepth, currentDepth + 1)
          );
        }
      } else if (entry.isFile()) {
        if (filenames.includes(entry.name)) {
          results.push(path.join(dir, entry.name));
        }
      }
    }
  } catch {
    // Permission or I/O error
  }

  return results;
}

/**
 * Checks if a specific executable exists and is executable.
 */
function isExecutable(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Discovers project capabilities and installed analyzers for a given workspace root.
 */
export async function detectProjectCapabilities(workspaceRoot: string): Promise<ProjectCapabilities> {
  const root = path.resolve(workspaceRoot);

  // 1. TypeScript / JavaScript Configs
  const tsconfigNames = ['tsconfig.json', 'jsconfig.json'];
  const rootTsconfig = path.join(root, 'tsconfig.json');
  const rootJsconfig = path.join(root, 'jsconfig.json');

  let tsconfigPaths: string[] = [];
  if (fs.existsSync(rootTsconfig)) {
    tsconfigPaths.push(rootTsconfig);
  }
  if (fs.existsSync(rootJsconfig)) {
    tsconfigPaths.push(rootJsconfig);
  }

  // Also check nested subprojects (e.g., packages, apps, test-fixtures, test-workspace)
  const nestedConfigs = findConfigFiles(root, tsconfigNames, 2);
  for (const p of nestedConfigs) {
    if (!tsconfigPaths.includes(p)) {
      tsconfigPaths.push(p);
    }
  }

  const hasTypeScript = tsconfigPaths.length > 0;

  // Resolve tsc executable
  let tscExecutable: string | undefined;
  const resolvedTsc = resolveTscExecutable(root);
  if (resolvedTsc) {
    tscExecutable = resolvedTsc.command;
  }

  // 2. ESLint Configs
  const eslintConfigNames = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    '.eslintrc.json',
    '.eslintrc',
  ];

  let eslintConfigPath: string | undefined;
  for (const name of eslintConfigNames) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) {
      eslintConfigPath = candidate;
      break;
    }
  }

  if (!eslintConfigPath) {
    const packageJsonPath = path.join(root, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (pkg.eslintConfig) {
          eslintConfigPath = packageJsonPath;
        }
      } catch {
        // ignore invalid package.json
      }
    }
  }

  const hasESLint = !!eslintConfigPath;
  let eslintExecutable: string | undefined;
  if (hasESLint) {
    const resolvedEslint = resolveEslintExecutable(root);
    if (resolvedEslint) {
      eslintExecutable = resolvedEslint.command;
    }
  }

  // 3. Python Analysis
  const pyConfigFiles = ['pyproject.toml', 'requirements.txt', 'pyrightconfig.json', 'setup.py'];
  let hasPython = false;
  for (const name of pyConfigFiles) {
    if (fs.existsSync(path.join(root, name))) {
      hasPython = true;
      break;
    }
  }

  // Also count Python files if no config found
  let pythonFilesCount = 0;
  if (!hasPython) {
    try {
      const files = fs.readdirSync(root);
      pythonFilesCount = files.filter((f) => f.endsWith('.py')).length;
      if (pythonFilesCount > 0) {
        hasPython = true;
      }
    } catch {
      // ignore
    }
  }

  let pyrightExecutable: string | undefined;
  if (hasPython) {
    const resolvedPy = resolvePyrightExecutable(root);
    if (resolvedPy) {
      pyrightExecutable = resolvedPy;
    }
  }

  return {
    workspaceRoot: root,
    hasTypeScript,
    tsconfigPaths,
    tscExecutable,
    hasESLint,
    eslintConfigPath,
    eslintExecutable,
    hasPython,
    pythonFilesCount,
    pyrightExecutable,
  };
}
