import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function walk(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))).flat();
}
const files = ['out/index.html', ...(await walk('out/_next/static')), ...(await readdir('out')).filter(f => /\.(?:png|ico|webmanifest|svg)$/.test(f)).map(f => `out/${f}`)];
const hash = createHash('sha256');
for (const file of files.sort()) { hash.update(file); hash.update(await readFile(file)); }
const version = hash.digest('hex').slice(0, 20);
await writeFile('out/offline-assets.json', JSON.stringify({ version, assets: files.map(f => f.slice(4)) }));
// Change the worker bytes with each shell build so installed PWAs refresh their offline assets too.
await writeFile('out/sw.js', `${await readFile('public/sw.js', 'utf8')}\n// Offline shell version: ${version}\n`);
console.log(`Offline shell: ${files.length} static assets`);
