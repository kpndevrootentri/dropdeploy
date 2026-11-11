import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React Compiler hint; flags the fetch-on-mount and sync-from-props effects used everywhere, not bugs.
      'react-hooks/set-state-in-effect': 'warn',
      // Flags the deliberate "latest ref" pattern (ref.current = prop during render).
      'react-hooks/refs': 'warn',
      // Flags a callback referenced in an effect before its declaration; it only runs after render.
      'react-hooks/immutability': 'warn',
      // Tests require() modules after jest.mock; their disable comments still name the old no-var-requires rule.
      '@typescript-eslint/no-require-imports': 'warn',
      // An apostrophe in JSX text renders fine; this is style.
      'react/no-unescaped-entities': 'warn',
      // Allow the shadcn `interface Props extends React.XHTMLAttributes<...> {}` pattern.
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'node_modules/**', // also covers the generated Prisma client in node_modules/.prisma
    'next-env.d.ts',
    'plugin/dist/**',
    'data/**',
    'projects/**',
    '.claude/**',
    '.codex/**',
    '.serena/**',
  ]),
]);
