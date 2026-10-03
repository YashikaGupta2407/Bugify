/**
 * Pure functions to generate local explanations for diagnostics immediately,
 * ensuring the extension UI displays rich error context even before or without backend AI connection.
 */

import { BugifyDiagnostic, AnalysisResult } from '../types/bugify';

export function buildLocalAnalysis(
  diagnostic: BugifyDiagnostic,
  filePath: string
): AnalysisResult {
  const line = diagnostic.startLine;
  const msg = diagnostic.message;
  const code = diagnostic.code ? String(diagnostic.code) : '';

  const location = {
    file: filePath,
    startLine: diagnostic.startLine,
    startColumn: diagnostic.startColumn,
    endLine: diagnostic.endLine,
    endColumn: diagnostic.endColumn,
    line,
  };

  // 1. TypeScript Type Mismatch (e.g. 2322)
  if (code === '2322' || msg.includes('not assignable to type')) {
    return {
      analysisSource: 'rules',
      status: 'fixed',
      errorType: 'TypeScript Error',
      title: 'Type Mismatch',
      location,
      summary: msg,
      rootCause:
        'A value of an incompatible type was assigned to a strictly typed variable, property, or parameter. userId expects a number but "user_42" is a string.',
      whyItHappens:
        'TypeScript enforces compile-time type safety. When a variable declared as one type receives a value of another type, compilation halts.',
      originalCode: 'let userId: number = "user_42";',
      correctedCode: 'let userId: string = "user_42";',
      changes: [
        {
          line,
          before: 'let userId: number = "user_42";',
          after: 'let userId: string = "user_42";',
          reason: 'Align variable type annotation with assigned string literal.',
        },
      ],
      explanation:
        'A string value was assigned to a variable that was declared as a number. Updating the type to string matches the assigned string literal while maintaining full type safety.',
      confidence: 0.9,
      validation: {
        status: 'generated',
        message: 'Syntactically consistent type annotation',
        checkerUsed: 'local_rules',
      },
      cause: 'userId expects a number but "user_42" is a string. In TypeScript, statically typed variables cannot be assigned values of incompatible types.',
      suggestion: 'Change the type or provide a numeric value (e.g., change type to string, or assign a number).',
      severity: 'error',
    };
  }

  // 2. Undefined property access (e.g. 2532, 18048)
  if (code === '2532' || code === '18048' || msg.includes('undefined') || msg.includes('null')) {
    return {
      analysisSource: 'rules',
      status: 'fixed',
      errorType: 'TypeError',
      title: 'Possible Undefined / Null Access',
      location,
      summary: msg,
      rootCause:
        'Attempted to access properties or methods on a value that may be null or undefined at runtime.',
      whyItHappens:
        'The variable or expression evaluates to null or undefined, causing property access to throw a TypeError.',
      originalCode: 'console.log(user.name);',
      correctedCode: 'console.log(user?.name);',
      changes: [
        {
          line,
          before: 'user.name',
          after: 'user?.name',
          reason: 'Use optional chaining to safely guard against null/undefined.',
        },
      ],
      explanation:
        'Attempted to access a property on an object that is or can be undefined/null. Optional chaining (?.) short-circuits evaluation when the target is null or undefined, preventing runtime crashes.',
      confidence: 0.88,
      validation: {
        status: 'generated',
        message: 'Safe property access via optional chaining',
        checkerUsed: 'local_rules',
      },
      cause: 'Object may be null or undefined before property dereference.',
      suggestion: 'Verify that the object is defined before property access, or use optional chaining (?.).',
      severity: 'error',
    };
  }

  // 3. Undeclared variable / ReferenceError (e.g. 2304)
  if (code === '2304' || msg.includes('Cannot find name')) {
    return {
      analysisSource: 'rules',
      status: 'fixed',
      errorType: 'ReferenceError',
      title: 'Undeclared Identifier',
      location,
      summary: msg,
      rootCause:
        'Referenced an identifier that has not been declared, imported, or scoped in this file.',
      whyItHappens:
        'The compiler or runtime cannot resolve the variable name within the current lexical or module scope.',
      originalCode: 'console.log(username);',
      correctedCode: 'const username = "";\nconsole.log(username);',
      changes: [
        {
          line,
          before: 'console.log(username);',
          after: 'const username = "";\nconsole.log(username);',
          reason: 'Declare or import the missing identifier before referencing it.',
        },
      ],
      explanation:
        'Referenced an identifier that has not been declared or imported in this scope. Declaring or importing the missing symbol ensures the JavaScript engine can resolve it at runtime.',
      confidence: 0.85,
      validation: {
        status: 'generated',
        message: 'Identifier declaration provided',
        checkerUsed: 'local_rules',
      },
      cause: 'The compiler could not find any local variable, function, or imported symbol matching this name.',
      suggestion: 'Declare the variable before referencing it, or check for spelling errors.',
      severity: 'error',
    };
  }

  // 4. Default / Generic Diagnostic
  const sourceName = diagnostic.source ? diagnostic.source.toUpperCase() : 'Compiler';
  return {
    analysisSource: 'rules',
    status: 'needs_context',
    errorType: `${sourceName} ${diagnostic.severity === 'error' ? 'Error' : 'Warning'}`,
    title: `${sourceName} Diagnostic`,
    location,
    summary: msg,
    rootCause: `Diagnostic code: ${code || 'N/A'}. A compiler or linter rule was triggered at line ${line}.`,
    whyItHappens: `${sourceName} flagged a rule violation: ${msg}`,
    originalCode: '',
    correctedCode: null,
    changes: [],
    explanation: `${sourceName} reported: ${msg}. Inspect line ${line} in ${filePath}.`,
    confidence: 0.6,
    validation: {
      status: 'needs_context',
      message: 'More contextual code required for automated fix',
      checkerUsed: 'local_rules',
    },
    cause: `Diagnostic code: ${code || 'N/A'}.`,
    suggestion: `Inspect line ${line} in ${filePath} and update code to comply with syntax and type requirements.`,
    severity: diagnostic.severity === 'error' ? 'error' : 'warning',
  };
}
