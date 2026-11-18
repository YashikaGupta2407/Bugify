"use strict";

/**
 * @typedef {Object} PythonAnalyzerResult
 * @property {BugifyIssue[]} issues
 * @property {AnalyzerStatus} status
 */
/**
 * Python Analyzer Runner (Pyright / Python Syntax Checker).
 * Safely checks Python files with timeout and cancellation.
 * If Pyright is installed, uses Pyright JSON diagnostics.
 * If Pyright is unavailable, uses python3 syntax compiler fallback.
 * Gracefully falls back to VS Code language server diagnostics without fabricating errors.
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
exports.runPythonAnalyzer = runPythonAnalyzer;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const pythonParser_1 = require("../parsers/pythonParser");
const envUtils_1 = require("../envUtils");
const logger_1 = require("../../logger");
const TIMEOUT_MS = 30000;
async function runPythonAnalyzer(workspaceRoot, hasPython, pythonFilesOrPyright, token) {
    const startTime = Date.now();
    if (!hasPython) {
        return {
            issues: [],
            status: {
                name: 'Python',
                type: 'pyright',
                status: 'not_configured',
                issueCount: 0,
                message: 'No Python project files detected.',
                durationMs: 0,
            },
        };
    }
    const pythonFiles = Array.isArray(pythonFilesOrPyright) ? pythonFilesOrPyright : undefined;
    // 1. Check if Pyright executable is available
    const pyright = (0, envUtils_1.resolvePyrightExecutable)(workspaceRoot);
    if (pyright) {
        logger_1.logger.log(`[Bugify] Running Pyright analyzer: ${pyright} --outputjson`);
        return executePyright(workspaceRoot, pyright, startTime, token);
    }
    // 2. Fallback: Python syntax compiler if python3 is available
    const pythonBin = findPythonExecutable();
    if (pythonBin && pythonFiles && pythonFiles.length > 0) {
        logger_1.logger.log(`[Bugify] Pyright not found; running Python syntax check with ${pythonBin} on ${pythonFiles.length} file(s)`);
        try {
            const issues = await executePythonSyntaxCheck(workspaceRoot, pythonFiles, pythonBin, token);
            const durationMs = Date.now() - startTime;
            return {
                issues,
                status: {
                    name: 'Python',
                    type: 'pyright',
                    status: 'completed',
                    issueCount: issues.length,
                    message: `Syntax checker found ${issues.length} issue(s)`,
                    durationMs,
                },
            };
        }
        catch (err) {
            logger_1.logger.log(`[Bugify] Python syntax check error: ${err.message || err}`);
        }
    }
    logger_1.logger.log('[Bugify] Pyright is unavailable. Gracefully consuming VS Code language server diagnostics.');
    return {
        issues: [],
        status: {
            name: 'Python',
            type: 'pyright',
            status: 'not_configured',
            issueCount: 0,
            message: 'Pyright CLI unavailable. Consuming VS Code diagnostics.',
            durationMs: Date.now() - startTime,
        },
    };
}
function findPythonExecutable() {
    const fs = require('fs');
    const candidates = ['/usr/local/bin/python3', '/usr/bin/python3', 'python3', 'python'];
    for (const c of candidates) {
        if (path.isAbsolute(c) && fs.existsSync(c)) {
            return c;
        }
    }
    return 'python3';
}
function executePyright(workspaceRoot, pyright, startTime, token) {
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const child = (0, child_process_1.spawn)(pyright, ['--outputjson'], {
            cwd: workspaceRoot,
            env: (0, envUtils_1.getAugmentedEnv)(),
            shell: false,
        });
        const timer = setTimeout(() => {
            timedOut = true;
            try {
                child.kill('SIGTERM');
            }
            catch {
                // ignore
            }
            resolve({
                issues: [],
                status: {
                    name: 'Python',
                    type: 'pyright',
                    status: 'timed_out',
                    issueCount: 0,
                    message: 'Python scan timed out (exceeded 30s limit).',
                    durationMs: Date.now() - startTime,
                },
            });
        }, TIMEOUT_MS);
        if (token) {
            const checkCancel = setInterval(() => {
                if (token.isCancellationRequested) {
                    clearInterval(checkCancel);
                    clearTimeout(timer);
                    try {
                        child.kill('SIGTERM');
                    }
                    catch {
                        // ignore
                    }
                    resolve({
                        issues: [],
                        status: {
                            name: 'Python',
                            type: 'pyright',
                            status: 'completed',
                            issueCount: 0,
                            message: 'Scan cancelled.',
                            durationMs: Date.now() - startTime,
                        },
                    });
                }
            }, 200);
        }
        child.stdout.on('data', (d) => {
            stdout += d.toString();
        });
        child.stderr.on('data', (d) => {
            stderr += d.toString();
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            logger_1.logger.log(`[Bugify] Python analyzer execution error: ${err.message}`);
            resolve({
                issues: [],
                status: {
                    name: 'Python',
                    type: 'pyright',
                    status: 'failed',
                    issueCount: 0,
                    message: `Python analyzer failed: ${err.message}`,
                    durationMs: Date.now() - startTime,
                },
            });
        });
        child.on('close', () => {
            clearTimeout(timer);
            if (timedOut)
                return;
            const durationMs = Date.now() - startTime;
            const issues = (0, pythonParser_1.parsePythonOutput)(stdout || stderr, workspaceRoot);
            logger_1.logger.log(`[Bugify] Python results: ${issues.length} issue(s) in ${durationMs}ms`);
            resolve({
                issues,
                status: {
                    name: 'Python',
                    type: 'pyright',
                    status: 'completed',
                    issueCount: issues.length,
                    message: `Found ${issues.length} diagnostic(s)`,
                    durationMs,
                },
            });
        });
    });
}
function executePythonSyntaxCheck(workspaceRoot, files, pythonBin, token) {
    return new Promise((resolve) => {
        const inlineScript = `
import sys, py_compile, re
files = sys.argv[1:]
for f in files:
    try:
        py_compile.compile(f, doraise=True)
    except py_compile.PyCompileError as err:
        msg = err.msg
        m = re.search(r'line (\\d+)', msg)
        line = int(m.group(1)) if m else 1
        lines = msg.strip().split('\\n')
        last_line = lines[-1] if lines else 'SyntaxError'
        print(f'{f}:{line}:1: error: {last_line}')
    except Exception:
        pass
`;
        const child = (0, child_process_1.spawn)(pythonBin, ['-c', inlineScript, ...files.slice(0, 100)], {
            cwd: workspaceRoot,
            env: (0, envUtils_1.getAugmentedEnv)(),
            shell: false,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => {
            stdout += d.toString();
        });
        child.stderr.on('data', (d) => {
            stderr += d.toString();
        });
        child.on('error', () => {
            resolve([]);
        });
        child.on('close', () => {
            const issues = (0, pythonParser_1.parsePythonOutput)(stdout || stderr, workspaceRoot);
            resolve(issues);
        });
    });
}
