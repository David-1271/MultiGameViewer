// Build: compile main/core (CommonJS) and renderer (ES modules), then copy static assets.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

rmSync(join(root, 'dist'), { recursive: true, force: true });
for (const project of ['tsconfig.json', 'tsconfig.renderer.json']) {
  try {
    execFileSync(process.execPath, [tsc, '-p', join(root, project)], { stdio: 'inherit', cwd: root });
  } catch {
    console.error(`TypeScript errors in ${project} (see above).`);
    process.exit(1);
  }
}

const STATIC = new Set(['.html', '.css', '.png', '.ico', '.svg']);
function copyStatic(fromDir, toDir) {
  for (const name of readdirSync(fromDir)) {
    const from = join(fromDir, name);
    if (statSync(from).isDirectory()) copyStatic(from, join(toDir, name));
    else if (STATIC.has(extname(name))) {
      mkdirSync(toDir, { recursive: true });
      cpSync(from, join(toDir, name));
    }
  }
}
copyStatic(join(root, 'src', 'renderer'), join(root, 'dist', 'renderer'));
copyStatic(join(root, 'assets'), join(root, 'dist', 'assets'));
console.log('build ok');
