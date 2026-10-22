import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function walk(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))).flat();
}
const files = ['out/index.html', ...(await walk('out/_next/static')), ...(await readdir('out')).filter(f => /\.(?:png|ico|webmanifest|svg)$/.test(f)).map(f => `out/${f}`)];
const hash = createHash('sha256');
for (const file of files.sort()) { hash.update(file); hash.update(await readFile(file)); }
await writeFile('out/offline-assets.json', JSON.stringify({ version: hash.digest('hex').slice(0, 20), assets: files.map(f => f.slice(4)) }));
console.log(`Offline shell: ${files.length} static assets`);
