// Compile local TS/TSX in memory for React tests. No app server or database is loaded.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/prisma') throw new Error('Database access is forbidden in game component tests');
    if (specifier === 'next/navigation' || specifier === 'next/link') {
      return { url: `game-test:${specifier}`, shortCircuit: true };
    }
    if (specifier.startsWith('@/')) {
      const base = new URL(`../../src/${specifier.slice(2)}`, import.meta.url);
      for (const suffix of ['.ts', '.tsx']) {
        try { return nextResolve(`${base.href}${suffix}`, context); } catch {}
      }
      return nextResolve(base.href, context);
    }
    return nextResolve(specifier, context.parentURL?.startsWith('game-test:')
      ? { ...context, parentURL: import.meta.url } : context);
  },
  load(url, context, nextLoad) {
    if (url === 'game-test:next/navigation') {
      return { format: 'module', shortCircuit: true, source: 'export const useRouter = () => globalThis.__gameTestRouter;' };
    }
    if (url === 'game-test:next/link') {
      return { format: 'module', shortCircuit: true, source: `import React from 'react'; export default function Link(props) { return React.createElement('a', props); }` };
    }
    if (/\.(ts|tsx)$/.test(url) && !url.includes('/node_modules/')) {
      return {
        format: 'module', shortCircuit: true,
        source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.ReactJSX }
        }).outputText
      };
    }
    return nextLoad(url, context);
  }
});
