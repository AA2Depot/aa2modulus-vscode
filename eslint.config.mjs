// @ts-check
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

// Keep logic unit-testable: only the activation entry point and the
// `vscode*.ts` adapters may load the editor API.
const VSCODE_IMPORT = {
  'name': 'vscode',
  'message': 'Only src/extension.ts and src/**/vscode*.ts adapters may import vscode.'
};

// docs/architecture.md: the src/ folders each folder may import.
const ALLOWED_IMPORTS = {
  shared: [],
  builtins: ['shared', 'server'],
  server: ['shared'],
  serverSetup: ['shared', 'server'],
  moduleCommands: ['shared', 'server']
};

// docs/code-style.md: syntax that src/ avoids.
const ID_LITERAL = {
  'selector': 'Literal[value=/^aa2m\\.[\\w.]+$/]',
  'message': 'Use the constants in src/shared/ids.ts for command IDs, setting keys and state keys.'
};
const CONDITIONAL_SPREAD = {
  'selector': 'ObjectExpression > SpreadElement > ConditionalExpression',
  'message': 'Build optional properties with if statements, not conditional spreads.'
};
const MODULE_LET = ['Program', 'Program > ExportNamedDeclaration'].map(parent => ({
  'selector': `${parent} > VariableDeclaration[kind="let"]`,
  'message': 'No mutable module-level state outside src/extension.ts.'
}));

// docs/code-style.md: rules for src/ and test/ alike.
const STYLE_RULES = {
  'no-nested-ternary': 'error',
  'no-duplicate-imports': 'error',
  '@stylistic/brace-style': ['error', '1tbs', { 'allowSingleLine': false }],
  '@stylistic/max-statements-per-line': ['error', { 'max': 1 }],
  '@stylistic/no-trailing-spaces': 'error',
  '@stylistic/comma-dangle': ['error', 'never'],
  '@typescript-eslint/consistent-type-imports': ['error', { 'fixStyle': 'inline-type-imports' }],
  '@typescript-eslint/no-import-type-side-effects': 'error'
};

/** `no-restricted-imports` for one src/ folder; adapters may import vscode. */
function importRules(folder, isAdapter) {
  const allowed = ALLOWED_IMPORTS[folder];
  const forbidden = Object.keys(ALLOWED_IMPORTS).filter(other => other !== folder && !allowed.includes(other));
  const summary = allowed.length === 0 ? 'no other src/ folder' : allowed.join(', ');
  return {
    'no-restricted-imports': ['error', {
      'paths': isAdapter ? [] : [VSCODE_IMPORT],
      'patterns': [{
        'group': [...forbidden.flatMap(other => [`../${other}`, `../${other}/**`]), '../extension'],
        'message': `src/${folder}/ may import ${summary} (docs/architecture.md).`
      }]
    }]
  };
}

export default defineConfig(
  {
    ignores: [
      '**/.vscode-test',
      '**/out'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    plugins: {
      '@stylistic': stylistic
    },
    rules: {
      'curly': 'error',
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/indent': ['error', 2, { 'SwitchCase': 1 }],
      '@stylistic/no-tabs': 'error',
      '@stylistic/max-len': ['error', {
        'code': 120,
        'ignoreStrings': true,
        'ignoreTemplateLiterals': true,
        'ignoreUrls': true,
        'ignoreRegExpLiterals': true
      }],
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          'argsIgnorePattern': '^_'
        }
      ]
    }
  },
  {
    // Tests of the vscode-free modules run without the editor API. e2e tests
    // run inside VS Code.
    files: ['test/**/*.ts'],
    ignores: ['test/e2e/**'],
    rules: {
      'no-restricted-imports': ['error', { 'paths': [VSCODE_IMPORT] }]
    }
  },
  // Per src/ folder: core modules may not import vscode, and no file imports a
  // folder that docs/architecture.md does not allow. src/extension.ts is free.
  ...Object.keys(ALLOWED_IMPORTS).flatMap(folder => [
    {
      files: [`src/${folder}/**/*.ts`],
      ignores: [`src/${folder}/**/vscode*.ts`],
      rules: importRules(folder, false)
    },
    {
      files: [`src/${folder}/**/vscode*.ts`],
      rules: importRules(folder, true)
    }
  ]),
  {
    // docs/code-style.md for src/.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ID_LITERAL, CONDITIONAL_SPREAD, ...MODULE_LET],
      ...STYLE_RULES,
      // Ceilings, not targets: docs/code-style.md asks for about 40 lines.
      'max-lines-per-function': ['error', { 'max': 60, 'skipBlankLines': true, 'skipComments': true }],
      'complexity': ['error', 15]
    }
  },
  // A later block that sets no-restricted-syntax replaces the selectors above,
  // so the exceptions repeat the selectors that still apply.
  {
    files: ['src/extension.ts'],
    rules: {
      'no-restricted-syntax': ['error', ID_LITERAL, CONDITIONAL_SPREAD]
    }
  },
  {
    files: ['src/shared/ids.ts'],
    rules: {
      'no-restricted-syntax': ['error', CONDITIONAL_SPREAD, ...MODULE_LET]
    }
  },
  {
    // docs/code-style.md for test/: the src/ rules without ID literals,
    // module-level let and complexity, with a higher length ceiling.
    files: ['test/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', CONDITIONAL_SPREAD],
      ...STYLE_RULES,
      'max-lines-per-function': ['error', { 'max': 80, 'skipBlankLines': true, 'skipComments': true }]
    }
  },
  {
    // A mocha suite callback holds all of its tests.
    files: ['test/e2e/*.test.ts'],
    rules: {
      'max-lines-per-function': 'off'
    }
  }
);
