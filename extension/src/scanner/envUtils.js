"use strict";

/**
 * @typedef {Object} ResolvedExecutable
 * @property {string} command
 * @property {string[]} argsPrefix
 * @property {string} description
 */
/**
 * Environment and Analyzer Executable Discovery Utilities.
 * Ensures tools (node, tsc, eslint, pyright) are located reliably across macOS, Linux, and Windows,
 * especially inside GUI environments where PATH is minimal.
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
exports.getAugmentedEnv = getAugmentedEnv;
exports.findNodeExecutable = findNodeExecutable;
exports.resolveTscExecutable = resolveTscExecutable;
exports.resolveEslintExecutable = resolveEslintExecutable;
exports.resolvePyrightExecutable = resolvePyrightExecutable;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Returns an augmented environment with standard developer binary paths.
 */
function getAugmentedEnv() {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const candidateDirs = [
        '/usr/local/bin',
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
        path.join(home, '.local', 'bin'),
        path.join(home, '.bun', 'bin'),
        path.join(home, '.cargo', 'bin'),
    ];
    // Also search ~/.nvm/versions/node/*/bin for installed Node versions
    const nvmDir = path.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmDir)) {
        try {
            const versions = fs.readdirSync(nvmDir).sort().reverse();
            for (const ver of versions) {
                candidateDirs.push(path.join(nvmDir, ver, 'bin'));
            }
        }
        catch {
            // ignore
        }
    }
    // Also include process.execPath directory if available
    if (process.execPath) {
        candidateDirs.unshift(path.dirname(process.execPath));
    }
    const currentPath = process.env.PATH || '';
    const parts = currentPath.split(path.delimiter).filter(Boolean);
    for (const dir of candidateDirs) {
        if (!parts.includes(dir) && fs.existsSync(dir)) {
            parts.push(dir);
        }
    }
    return {
        ...process.env,
        PATH: parts.join(path.delimiter),
        CI: 'true',
        NO_COLOR: '1',
    };
}
/**
 * Finds the Node.js executable on the system.
 */
function findNodeExecutable() {
    // If running inside Node CLI directly
    if (process.execPath && !process.execPath.includes('Electron') && !process.execPath.includes('Code') && !process.execPath.includes('Antigravity')) {
        if (fs.existsSync(process.execPath)) {
            return process.execPath;
        }
    }
    const candidates = [
        '/usr/local/bin/node',
        '/opt/homebrew/bin/node',
        '/usr/bin/node',
    ];
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const nvmDir = path.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmDir)) {
        try {
            const versions = fs.readdirSync(nvmDir).sort().reverse();
            for (const ver of versions) {
                candidates.push(path.join(nvmDir, ver, 'bin', 'node'));
            }
        }
        catch {
            // ignore
        }
    }
    for (const c of candidates) {
        if (fs.existsSync(c)) {
            return c;
        }
    }
    return 'node';
}
/**
 * Checks if a file exists and is executable or readable.
 */
function isFileAccessible(filePath) {
    try {
        return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    }
    catch {
        return false;
    }
}
/**
 * Walks up directory hierarchy looking for node_modules/typescript/lib/tsc.js
 */
function findUpTscJs(startDir, stopDir) {
    let cur = path.resolve(startDir);
    const stop = path.resolve(stopDir);
    while (true) {
        const candidate = path.join(cur, 'node_modules', 'typescript', 'lib', 'tsc.js');
        if (isFileAccessible(candidate)) {
            return candidate;
        }
        if (cur === stop || path.dirname(cur) === cur) {
            break;
        }
        cur = path.dirname(cur);
    }
    return null;
}
/**
 * Resolves the TypeScript compiler runner for a given project/configuration.
 * Priority:
 * 1. Project-local typescript/lib/tsc.js via Node
 * 2. Project-local node_modules/.bin/tsc
 * 3. Configuration-folder local typescript
 * 4. System global tsc
 * 5. Bundled vendor typescript compiler
 */
function resolveTscExecutable(workspaceRoot, configPath) {
    const nodeBin = findNodeExecutable();
    // 1. Workspace root local typescript/lib/tsc.js
    const rootTscJs = path.join(workspaceRoot, 'node_modules', 'typescript', 'lib', 'tsc.js');
    if (isFileAccessible(rootTscJs)) {
        return {
            command: nodeBin,
            argsPrefix: [rootTscJs],
            description: 'project local typescript',
        };
    }
    // 2. Config folder or parent search
    if (configPath) {
        const configDir = path.dirname(configPath);
        const foundTscJs = findUpTscJs(configDir, workspaceRoot);
        if (foundTscJs) {
            return {
                command: nodeBin,
                argsPrefix: [foundTscJs],
                description: 'project subfolder typescript',
            };
        }
    }
    // 3. Workspace root local node_modules/.bin/tsc
    const rootBinTsc = path.join(workspaceRoot, 'node_modules', '.bin', 'tsc');
    if (isFileAccessible(rootBinTsc)) {
        return {
            command: nodeBin,
            argsPrefix: [rootBinTsc],
            description: 'project node_modules/.bin/tsc',
        };
    }
    // 4. Check extension vendor / bundled typescript compiler
    const bundledCandidates = [
        // Built extension vendor directory
        path.resolve(__dirname, '../../vendor/typescript/lib/tsc.js'),
        path.resolve(__dirname, '../../../vendor/typescript/lib/tsc.js'),
        // Extension node_modules fallback
        path.resolve(__dirname, '../../node_modules/typescript/lib/tsc.js'),
        path.resolve(__dirname, '../../../node_modules/typescript/lib/tsc.js'),
    ];
    for (const candidate of bundledCandidates) {
        if (isFileAccessible(candidate)) {
            return {
                command: nodeBin,
                argsPrefix: [candidate],
                description: 'Bugify bundled typescript compiler',
            };
        }
    }
    // 5. System tsc in PATH
    const systemCandidates = ['/usr/local/bin/tsc', '/opt/homebrew/bin/tsc'];
    for (const sc of systemCandidates) {
        if (isFileAccessible(sc)) {
            return {
                command: sc,
                argsPrefix: [],
                description: 'system global tsc',
            };
        }
    }
    return null;
}
/**
 * Resolves the ESLint executable for a given workspace root.
 */
function resolveEslintExecutable(workspaceRoot) {
    const nodeBin = findNodeExecutable();
    // 1. Workspace root local node_modules/eslint/bin/eslint.js
    const rootEslintJs = path.join(workspaceRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');
    if (isFileAccessible(rootEslintJs)) {
        return {
            command: nodeBin,
            argsPrefix: [rootEslintJs],
            description: 'project local eslint',
        };
    }
    // 2. Workspace root node_modules/.bin/eslint
    const rootBinEslint = path.join(workspaceRoot, 'node_modules', '.bin', 'eslint');
    if (isFileAccessible(rootBinEslint)) {
        return {
            command: nodeBin,
            argsPrefix: [rootBinEslint],
            description: 'project node_modules/.bin/eslint',
        };
    }
    // 3. System eslint in PATH
    const systemCandidates = ['/usr/local/bin/eslint', '/opt/homebrew/bin/eslint'];
    for (const sc of systemCandidates) {
        if (isFileAccessible(sc)) {
            return {
                command: sc,
                argsPrefix: [],
                description: 'system global eslint',
            };
        }
    }
    return null;
}
/**
 * Resolves the Pyright/Python analyzer for a given workspace root.
 */
function resolvePyrightExecutable(workspaceRoot) {
    const candidates = [
        path.join(workspaceRoot, '.venv', 'bin', 'pyright'),
        path.join(workspaceRoot, 'venv', 'bin', 'pyright'),
        path.join(workspaceRoot, 'node_modules', '.bin', 'pyright'),
        '/usr/local/bin/pyright',
        '/opt/homebrew/bin/pyright',
    ];
    for (const c of candidates) {
        if (isFileAccessible(c)) {
            return c;
        }
    }
    return null;
}
