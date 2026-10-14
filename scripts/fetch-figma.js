/**
 * Fetch Nafs-mobile Figma file structure once FIGMA_ACCESS_TOKEN is available.
 * Usage: FIGMA_ACCESS_TOKEN=xxx npm run figma:fetch
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const token = process.env.FIGMA_ACCESS_TOKEN;
const fileKey = process.env.FIGMA_FILE_KEY || 'tkBoHPyvyuhwBW3rvjPMtN';

if (!token) {
  console.error('Set FIGMA_ACCESS_TOKEN in .env or the environment first.');
  process.exit(1);
}

async function main() {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=2`, {
    headers: { 'X-Figma-Token': token },
  });
  if (!res.ok) {
    console.error('Figma API error', res.status, await res.text());
    process.exit(1);
  }
  const data = await res.json();
  const outDir = path.join(__dirname, '..', 'docs');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'figma-inventory.json');

  function walk(node, acc = [], depth = 0) {
    if (!node) return acc;
    if (node.type === 'CANVAS' || node.type === 'FRAME' || node.type === 'COMPONENT') {
      acc.push({ id: node.id, name: node.name, type: node.type, depth });
    }
    for (const child of node.children || []) walk(child, acc, depth + 1);
    return acc;
  }

  const inventory = {
    name: data.name,
    lastModified: data.lastModified,
    pages: (data.document?.children || []).map((page) => ({
      id: page.id,
      name: page.name,
      frames: walk(page).filter((n) => n.type === 'FRAME'),
    })),
  };

  fs.writeFileSync(outPath, JSON.stringify(inventory, null, 2));
  console.log(`Wrote ${outPath}`);
  for (const page of inventory.pages) {
    console.log(`\n# ${page.name}`);
    for (const frame of page.frames.slice(0, 100)) {
      console.log(`- ${frame.name} (${frame.id})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
