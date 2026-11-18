"use strict";
/**
 * Project capability and analyzer detector.
 * Discovers available static analysis tools in the target workspace.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.findSourceFiles = findSourceFiles;
exports.detectProjectCapabilities = detectProjectCapabilities;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const envUtils_1 = require("./envUtils");
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
function findConfigFiles(dir, filenames, maxDepth = 3, currentDepth = 0) {
    if (currentDepth > maxDepth || !fs.existsSync(dir)) {
        return [];
    }
    const results = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) {
                    results.push(...findConfigFiles(path.join(dir, entry.name), filenames, maxDepth, currentDepth + 1));
                }
            }
            else if (entry.isFile()) {
                if (filenames.includes(entry.name)) {
                    results.push(path.join(dir, entry.name));
                }
            }
        }
    }
    catch {
        // Permission or I/O error
    }
    return results;
}
/**
 * Recursively discovers source files matching given extensions up to maxDepth and limit.
 */
function findSourceFiles(dir, extensions, maxDepth = 4, maxFiles = 250, currentDepth = 0) {
    if (currentDepth > maxDepth || !fs.existsSync(dir)) {
        return [];
    }
    const results = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (results.length >= maxFiles)
                break;
            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                    results.push(...findSourceFiles(path.join(dir, entry.name), extensions, maxDepth, maxFiles - results.length, currentDepth + 1));
                }
            }
            else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (extensions.includes(ext) && !entry.name.endsWith('.d.ts')) {
                    results.push(path.join(dir, entry.name));
                }
            }
        }
    }
    catch {
        // Permission or I/O error
    }
    return results;
}
/**
 * Checks if a specific executable exists and is executable.
 */
function isExecutable(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return false;
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Discovers project capabilities and installed analyzers for a given workspace root.
 */
async function detectProjectCapabilities(workspaceRoot) {
    const root = path.resolve(workspaceRoot);
    // 1. TypeScript / JavaScript Configs
    const tsconfigNames = ['tsconfig.json', 'jsconfig.json'];
    const rootTsconfig = path.join(root, 'tsconfig.json');
    const rootJsconfig = path.join(root, 'jsconfig.json');
    let tsconfigPaths = [];
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
    // If no tsconfig/jsconfig found, discover .ts, .tsx, .js, .jsx source files in the project
    let jsTsSourceFiles = [];
    if (tsconfigPaths.length === 0) {
        const discovered = findSourceFiles(root, ['.ts', '.tsx', '.js', '.jsx'], 4, 150);
        if (discovered.length > 0) {
            jsTsSourceFiles = discovered.map((p) => path.relative(root, p).replace(/\\/g, '/'));
        }
    }
    const hasTypeScript = tsconfigPaths.length > 0 || jsTsSourceFiles.length > 0;
    // Resolve tsc executable
    let tscExecutable;
    const resolvedTsc = (0, envUtils_1.resolveTscExecutable)(root);
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
    let eslintConfigPath;
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
            }
            catch {
                // ignore invalid package.json
            }
        }
    }
    const hasESLint = !!eslintConfigPath;
    let eslintExecutable;
    if (hasESLint) {
        const resolvedEslint = (0, envUtils_1.resolveEslintExecutable)(root);
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
    // Also count and discover Python files
    let pythonSourceFiles = [];
    const discoveredPy = findSourceFiles(root, ['.py'], 4, 150);
    let pythonFilesCount = discoveredPy.length;
    if (pythonFilesCount > 0) {
        hasPython = true;
        pythonSourceFiles = discoveredPy.map((p) => path.relative(root, p).replace(/\\/g, '/'));
    }
    let pyrightExecutable;
    if (hasPython) {
        const resolvedPy = (0, envUtils_1.resolvePyrightExecutable)(root);
        if (resolvedPy) {
            pyrightExecutable = resolvedPy;
        }
    }
    return {
        workspaceRoot: root,
        hasTypeScript,
        tsconfigPaths,
        tscExecutable,
        sourceFiles: jsTsSourceFiles.length > 0 ? jsTsSourceFiles : undefined,
        hasESLint,
        eslintConfigPath,
        eslintExecutable,
        hasPython,
        pythonFilesCount,
        pythonSourceFiles: pythonSourceFiles.length > 0 ? pythonSourceFiles : undefined,
        pyrightExecutable,
    };
}
