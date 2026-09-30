// Run by the deploy workflow: gives every script and stylesheet a ?v=<version> URL so browsers never mix
// cached files from an older deploy with new ones. Nested module imports are versioned through an import map.
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';

const version = (process.argv[2] || Date.now().toString(36)).replace(/[^\w.-]/g, '');
const page = 'site/index.html';
let html = readFileSync(page, 'utf8');
const modules = readdirSync('site/js').filter(f => f.endsWith('.js')).sort();
const map = {imports: Object.fromEntries(modules.map(f => [`./js/${f}`, `./js/${f}?v=${version}`]))};
const marker = '<!-- asset-map -->';
if (!html.includes(marker)) throw new Error(`${page} is missing the ${marker} placeholder`);
html = html.replace(marker, `<script type="importmap">${JSON.stringify(map)}</script>`)
  .replace('href="styles.css"', `href="styles.css?v=${version}"`)
  .replace('src="js/app.js"', `src="js/app.js?v=${version}"`);
writeFileSync(page, html);
console.log(`Stamped ${modules.length} modules and the stylesheet with v=${version}`);
