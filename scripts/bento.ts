import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Stats } from './stats';

const root = join(import.meta.dir, '..');
const stats: Stats = JSON.parse(readFileSync(join(import.meta.dir, 'stats.json'), 'utf8'));

const color = {
  pink: '#fcd3d1',
  white: '#fffaf7',
  blush: '#fee8e6',
  red: '#c7384a',
  ink: '#2a2628',
  border: '#f6bcba',
  glow: '#fee6e4',
};

const SITE = 'https://vastamaki.dev/';
const GITHUB = 'https://github.com/vastamaki';

// Below this viewport width GitHub drops the sidebar and the README gets narrow.
const MOBILE = '(max-width: 767px)';

// The images sit flush in the README, so the gaps are padding inside each SVG.
// Less padding vertically, because GitHub adds a few px under every image row.
const PAD_X = 6;
const PAD_Y = 3;
// Rows stacked inside one image don't get that, so they need it added back.
const ROW_GAP = 6;

// GitHub serves README images through <img>, which blocks external fonts.
function fontFace(family: string, weight: number, file: string) {
  const data = readFileSync(join(import.meta.dir, 'fonts', file)).toString('base64');
  return `@font-face{font-family:${family};font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2')}`;
}

const fonts = {
  display: fontFace('BG', 800, 'bricolage-grotesque-latin-800-normal.woff2'),
  regular: fontFace('HG', 400, 'host-grotesk-latin-400-normal.woff2'),
  medium: fontFace('HG', 500, 'host-grotesk-latin-500-normal.woff2'),
};
type Font = keyof typeof fonts;

const baseCss = `
.h{font-family:BG,'Arial Black','Helvetica Neue',Arial,sans-serif;font-weight:800;letter-spacing:-.012em}
.b{font-family:HG,-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-weight:400}
.m{font-weight:500}
.label{font-size:13px;font-weight:500;fill-opacity:.85}
.panel{transform-box:fill-box;transform-origin:var(--o,0% 0%);animation:wipe .7s cubic-bezier(.7,0,.2,1) var(--t,0s) both}
@keyframes wipe{from{transform:var(--from,scaleX(0))}}
.in{animation:in .6s cubic-bezier(.7,0,.2,1) calc(var(--t,0s) + .25s + var(--n,0)*.12s) both}
@keyframes in{0%{opacity:0;transform:translateY(18px)}30%{opacity:1}}
.draw{stroke-dasharray:1;animation:draw .9s cubic-bezier(.7,0,.2,1) calc(var(--t,0s) + .5s) both}
@keyframes draw{from{stroke-dashoffset:1}}
.edge{animation:show .01s linear calc(var(--t,0s) + .7s) both}
@keyframes show{from{opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
`;

// Every tile builds itself on load: the panel wipes in from one side, then its
// content snaps up one piece at a time. delay is when the tile starts, in seconds.
const wipes = {
  left: '--from:scaleX(0)',
  top: '--from:scaleY(0)',
  right: '--from:scaleX(0);--o:100% 0%',
  bottom: '--from:scaleY(0);--o:0% 100%',
};

interface Tile {
  width: number;
  height: number;
  fonts: Font[];
  css: string;
  defs: string;
  body: string;
}

interface TileOptions {
  name: string;
  width: number;
  height: number;
  background: string;
  textColor?: string;
  delay: number;
  wipe?: keyof typeof wipes;
  fonts: Font[];
  css?: string;
  defs?: string;
  draw: (w: number, h: number) => string;
}

function tile(options: TileOptions): Tile {
  const { name, width, height, background } = options;
  const w = width - PAD_X * 2;
  const h = height - PAD_Y * 2;

  // white tiles vanish on GitHub's light theme without a border
  const border =
    background === color.white
      ? `<rect class="edge" x=".75" y=".75" width="${w - 1.5}" height="${h - 1.5}" rx="19.25" fill="none" stroke="${color.border}" stroke-width="1.5"/>`
      : '';

  return {
    width,
    height,
    fonts: options.fonts,
    css: options.css ?? '',
    defs: `${options.defs ?? ''}<clipPath id="clip-${name}"><rect width="${w}" height="${h}" rx="20"/></clipPath>`,
    body: `<g clip-path="url(#clip-${name})" fill="${options.textColor ?? color.ink}" style="--t:${options.delay}s;${wipes[options.wipe ?? 'left']}">
<rect class="panel" width="${w}" height="${h}" fill="${background}"/>
${options.draw(w, h)}
${border}
</g>`,
  };
}

// Lays tiles out in rows and returns one SVG document.
function sheet(alt: string, rows: Tile[][]) {
  const tiles = rows.flat();
  const width = Math.max(...rows.map((row) => row.reduce((sum, t) => sum + t.width, 0)));
  const height = rows.reduce((sum, row) => sum + row[0]!.height, 0) + (rows.length - 1) * ROW_GAP;
  const used = [...new Set(tiles.flatMap((t) => t.fonts))];
  const css = [...new Set(tiles.map((t) => t.css))].join('\n');

  let y = 0;
  const placed = rows.map((row) => {
    let x = 0;
    const line = row.map((t) => {
      const g = `<g transform="translate(${x + PAD_X} ${y + PAD_Y})">\n${t.body}\n</g>`;
      x += t.width;
      return g;
    });
    y += row[0]!.height + ROW_GAP;
    return line.join('\n');
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${alt}">
<defs>${tiles.map((t) => t.defs).join('')}
<style>${used.map((f) => fonts[f]).join('')}${baseCss}${css}</style></defs>
${placed.join('\n')}
</svg>
`;
}

function icon(name: string, x: number, y: number, size: number, fill: string) {
  const file = readFileSync(join(import.meta.dir, 'icons', `${name}.svg`), 'utf8');
  const path = file.match(/ d="([^"]+)"/)![1];
  return `<path transform="translate(${x} ${y}) scale(${size / 24})" fill="${fill}" d="${path}"/>`;
}

function arrow(x: number, y: number, stroke: string) {
  return `<path class="arrow" d="M${x} ${y + 12} ${x + 12} ${y}M${x + 3} ${y}h9v9" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

const boxedWordCss = `.big{font-size:54px}
.sign{transform-box:fill-box;--s:calc(var(--t,0s) + .25s + var(--n,0)*.12s);animation:settle 2.4s cubic-bezier(.3,0,.4,1) var(--s) both,swing 7s ease-in-out calc(var(--s) + 2.4s + var(--w,0s)) infinite}
.box{transform-box:fill-box;transform-origin:0% 50%;--from:scaleX(0);animation:wipe .6s cubic-bezier(.7,0,.2,1) var(--s) both}
.drop{transform-origin:0% 0%;transform:rotate(3deg);--a:3deg}
.lift{transform-origin:0% 100%;transform:rotate(-3deg);--a:-3deg;--w:3.5s}
@keyframes settle{0%,40%{transform:rotate(0deg)}58%{transform:rotate(calc(var(--a)*1.45))}72%{transform:rotate(calc(var(--a)*.75))}86%{transform:rotate(calc(var(--a)*1.12))}100%{transform:rotate(var(--a))}}
@keyframes swing{0%,78%,100%{transform:rotate(var(--a))}84%{transform:rotate(calc(var(--a)*1.6))}90%{transform:rotate(calc(var(--a)*.7))}95%{transform:rotate(calc(var(--a)*1.15))}}
@media (prefers-reduced-motion:reduce){.sign{animation:none}}`;

// textWidth is measured in a browser. textLength pins it, so the box still
// fits if the font fails to load.
function boxedWord(tilt: 'lift' | 'drop', x: number, y: number, textWidth: number, word: string, n: number) {
  return `<g class="sign ${tilt}" style="--n:${n}"><rect class="box" x="${x}" y="${y}" width="${textWidth + 28}" height="68" rx="12" fill="${color.red}"/>
<text class="h big in" style="--n:${n + 3}" x="${x + 14}" y="${y + 50}" textLength="${textWidth}" lengthAdjust="spacingAndGlyphs" fill="${color.white}">${word}</text></g>`;
}

// <switch> shows the first entry matching the browser language; null is the fallback.
const greetings: [string | null, string][] = [
  ['fi', 'Moi'],
  ['sv', 'Hej'],
  ['et', 'Tere'],
  ['nb', 'Hei'],
  ['no', 'Hei'],
  ['da', 'Hej'],
  ['de', 'Hallo'],
  ['fr', 'Salut'],
  ['es', 'Hola'],
  ['pt', 'Olá'],
  ['it', 'Ciao'],
  ['nl', 'Hoi'],
  ['pl', 'Cześć'],
  ['uk', 'Привіт'],
  ['ru', 'Привет'],
  ['tr', 'Selam'],
  ['ar', 'مرحبا'],
  ['hi', 'नमस्ते'],
  ['ja', 'こんにちは'],
  ['ko', '안녕하세요'],
  ['zh', '你好'],
  [null, 'Hello'],
];

function hello() {
  const greeting = greetings
    .map(([lang, word]) => `<text class="h big" x="28" y="112"${lang ? ` systemLanguage="${lang}"` : ''}>${word}!</text>`)
    .join('\n');

  return tile({
    name: 'hello',
    width: 425,
    height: 300,
    background: color.pink,
    delay: 0,
    fonts: ['display', 'regular', 'medium'],
    css: `${boxedWordCss}
.turn{transform-box:fill-box;transform-origin:50% 50%;animation:turn 4s ease-in-out infinite alternate}
@keyframes turn{from{transform:scaleX(.12)}to{transform:scaleX(2.3)}}
@media (prefers-reduced-motion:reduce){.turn{animation:none}}
.n{font-size:12.5px;fill-opacity:.92}.dk,.ff,.sf{display:none}
@media (prefers-color-scheme:dark){.lt{display:none}.dk{display:inline}}
@supports (-moz-appearance:none){.cr{display:none}.ff{display:inline}}
@supports (font:-apple-system-body) and (-webkit-appearance:none){.cr{display:none}.sf{display:inline}}`,
    draw: (w) => `<g class="draw" fill="none" stroke="${color.ink}" stroke-width="1.6" transform="translate(${w - 42} 40)"><circle pathLength="1" r="14"/><ellipse class="turn" pathLength="1" rx="6" ry="14"/><path pathLength="1" d="M-14 0H14M-12-7H12M-12 7H12"/></g>
<text class="b label in" x="28" y="46">Software engineer from Finland</text>
<g class="in" style="--n:1"><switch>
${greeting}
</switch></g>
<text class="h big in" style="--n:2" x="28" y="182">I'm</text>
${boxedWord('lift', 122, 132, 191, 'Viljami.', 3)}
<text class="b n in" style="--n:8"><tspan x="28" y="246">This image has no JavaScript. It still knows you</tspan><tspan x="28" y="264">use <tspan class="m"><tspan class="lt">light</tspan><tspan class="dk">dark</tspan> mode</tspan>, <tspan class="m"><tspan class="cr">Chrome</tspan><tspan class="ff">Firefox</tspan><tspan class="sf">Safari</tspan></tspan>, and your language.</tspan></text>`,
  });
}

function headline() {
  // Without motion the rings rest at 60, 105, 150 and 195; animated, they ripple out of the corner.
  const rings = (w: number) =>
    [0.5, 0.875, 1.25, 1.625]
      .map((scale, i) => `<circle class="ring" style="--s:${scale};--d:${-i * 2.25}s" cx="${w - 20}" cy="4" r="120" fill="none" stroke="${color.ink}" stroke-opacity=".13" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`)
      .join('');

  return tile({
    name: 'headline',
    width: 425,
    height: 300,
    background: color.pink,
    delay: 0.4,
    wipe: 'top',
    fonts: ['display', 'medium'],
    defs: `<radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(330 -40) scale(480 290)"><stop offset="0" stop-color="${color.glow}"/><stop offset=".6" stop-color="${color.glow}" stop-opacity="0"/></radialGradient>`,
    css: `${boxedWordCss}
.ring{transform-box:fill-box;transform-origin:50% 50%;transform:scale(var(--s));animation:ripple 9s linear var(--d) infinite}
@keyframes ripple{0%{transform:scale(.2);stroke-opacity:0}15%{stroke-opacity:.2}100%{transform:scale(1.9);stroke-opacity:0}}
@media (prefers-reduced-motion:reduce){.ring{animation:none}}`,
    draw: (w, h) => `<rect class="in" width="${w}" height="${h}" fill="url(#glow)"/>
<g class="in">${rings(w)}</g>
<text class="b label in" x="28" y="46">Welcome to</text>
<text class="h big in" style="--n:1" x="28" y="112">The place</text>
<text class="h big in" style="--n:2" x="28" y="168">where I</text>
${boxedWord('drop', 28, 186, 342.6, 'break things.', 3)}`,
  });
}

function about(width: number, height: number) {
  const lines = ['I build web apps end to end, from the', 'database to the last pixel, and hunt', 'bugs on the side.'];

  return tile({
    name: 'about',
    width,
    height,
    background: color.white,
    delay: 1.3,
    fonts: ['regular', 'medium'],
    draw: (w, h) => `<text class="b label in" x="28" y="38">About</text>
${lines.map((line, i) => `<text class="b in" style="--n:${1 + i}" font-size="15.5" x="28" y="${66 + i * 23}">${line}</text>`).join('')}
<g class="in" style="--n:4"><rect x="${w - 28 - 132}" y="${h - 22 - 34}" width="132" height="34" rx="17" fill="${color.red}"/>
<text class="b m" font-size="14" x="${w - 28 - 66}" y="${h - 22 - 12}" text-anchor="middle" fill="${color.white}">vastamaki.dev</text></g>`,
  });
}

function pill(x: number, y: number, label: string) {
  // no way to measure text here, so the width is a per-character guess
  const width = Math.round(label.length * 7.1 + 46);
  const svg =
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${width}" height="28" rx="14" fill="none" stroke="${color.ink}" stroke-opacity=".6"/>` +
    icon(label.toLowerCase(), x + 11, y + 7, 14, color.ink) +
    `<text class="b" font-size="13" x="${x + 31}" y="${y + 19}">${label}</text>`;
  return { svg, width };
}

function stack(width: number, height: number) {
  return tile({
    name: 'stack',
    width,
    height,
    background: color.blush,
    delay: 1.6,
    wipe: 'top',
    fonts: ['regular', 'medium'],
    draw: (w) => {
      let out = `<text class="b label in" x="28" y="36">Stack, all the way</text>`;
      let x = 28;
      let y = 52;
      for (const [i, label] of ['Bun', 'TypeScript', 'PostgreSQL', 'Vite', 'React'].entries()) {
        let p = pill(x, y, label);
        if (x + p.width > w - 14) {
          x = 28;
          y += 34;
          p = pill(x, y, label);
        }
        out += `<g class="in" style="--n:${1 + i}">${p.svg}</g>`;
        x += p.width + 8;
      }
      return out;
    },
  });
}

// One square per day, oldest first, four to a column.
function activity(x: number, y: number, columns: number) {
  const opacity = [0.1, 0.3, 0.5, 0.75, 1];
  const days = stats.heat.slice(-columns * 4);
  return days
    .map((level, i) => {
      const sx = x + Math.floor(i / 4) * 8.5;
      const sy = y + (i % 4) * 8.5;
      const cls = i === days.length - 1 ? 'sq today' : 'sq';
      return `<rect class="${cls}" style="--k:${i}" x="${sx}" y="${sy}" width="6" height="6" rx="1.5" fill="${color.red}" fill-opacity="${opacity[level]}"/>`;
    })
    .join('');
}

const total = stats.contributions.toLocaleString('en-US');

function contributions(width: number, height: number) {
  return tile({
    name: 'contributions',
    width,
    height,
    background: color.white,
    delay: 1.9,
    wipe: 'right',
    fonts: ['display', 'regular', 'medium'],
    css: `.sq{--q:calc(var(--t,0s) + .7s + var(--k)*.03s);animation:show .01s linear var(--q) both}
.today{transform-box:fill-box;transform-origin:50% 50%;animation:show .01s linear var(--q) both,pulse 2.4s ease-in-out calc(var(--t,0s) + 2.2s) infinite}
@keyframes pulse{50%{transform:scale(1.7)}}
@media (prefers-reduced-motion:reduce){.today{animation:none}}`,
    draw: (w) => `<text class="b label in" x="28" y="42">On GitHub</text>
${activity(w - 28 - 10 * 8.5 + 2.5, 24, 10)}
<text class="h in" style="--n:2" font-size="${total.length > 5 ? 50 : 58}" x="26" y="106" fill="${color.red}">${total}</text>
<text class="b in" style="--n:4" font-size="14" x="28" y="134">contributions since ${stats.since}</text>`,
  });
}

function languages(width: number, height: number) {
  const listed = stats.languages.reduce((sum, lang) => sum + lang.percent, 0);
  const langs = [...stats.languages, { name: 'Other', percent: Math.max(0, 100 - listed) }];
  const shades = [1, 0.72, 0.52, 0.36, 0.24];
  const compact = width < 300;
  const pad = compact ? 18 : 28;
  const top = compact ? -6 : 0;

  return tile({
    name: 'languages',
    width,
    height,
    background: color.pink,
    delay: 2.6,
    fonts: ['regular', 'medium'],
    css: `.seg{transform-box:fill-box;transform-origin:0% 50%;animation:grow .45s cubic-bezier(.7,0,.2,1) calc(var(--t,0s) + .5s + var(--k)*.2s) both}
@keyframes grow{from{transform:scaleX(0)}}`,
    draw: (w) => {
      const barWidth = w - pad * 2;

      let offset = 0;
      const bar = langs
        .map((lang, i) => {
          const segment = (barWidth * lang.percent) / 100;
          const rect = `<rect class="seg" style="--k:${i}" x="${(pad + offset).toFixed(1)}" y="${54 + top}" width="${segment.toFixed(1)}" height="12" fill="${color.ink}" fill-opacity="${shades[i]}"/>`;
          offset += segment;
          return rect;
        })
        .join('');

      // as many names as fit on one line
      let x = pad;
      let legend = '';
      for (const [i, lang] of stats.languages.entries()) {
        const textWidth = lang.name.length * 6.8;
        if (x + 16 + textWidth > w - pad + 8) break;
        legend += `<g class="in" style="--n:${5 + i}"><circle cx="${x + 5}" cy="${89 + top}" r="5" fill="${color.ink}" fill-opacity="${shades[i]}"/><text class="b" font-size="12.5" x="${x + 16}" y="${93.5 + top}">${lang.name}</text></g>`;
        x += 16 + textWidth + 16;
      }

      return `<text class="b label in" x="${pad}" y="${38 + top}">Mostly writing</text><clipPath id="bar"><rect x="${pad}" y="${54 + top}" width="${barWidth}" height="12" rx="6"/></clipPath><g clip-path="url(#bar)">${bar}</g>${legend}`;
    },
  });
}

function link(name: string, label: string, width: number, height: number, background: string, textColor: string, delay: number, wipe: keyof typeof wipes) {
  const compact = width < 150;
  const fontSize = compact ? 11.5 : label.length > 9 ? 15 : 17;
  const inset = compact ? 16 : 22;

  return tile({
    name,
    width,
    height,
    background,
    textColor,
    delay,
    wipe,
    fonts: ['medium'],
    css: `.arrow{animation:hop 5s ease-in-out ${delay + 3}s infinite}
@keyframes hop{0%,78%,100%{transform:translate(0,0)}88%{transform:translate(3px,-3px)}}
@media (prefers-reduced-motion:reduce){.arrow{animation:none}}`,
    draw: (w, h) =>
      `<g class="in" style="--n:1">${icon(name, inset, inset - 2, compact ? 24 : 28, textColor)}</g>` +
      `<g class="in" style="--n:2">${arrow(w - inset - 12, inset, textColor)}</g>` +
      `<text class="b m in" style="--n:3" font-size="${fontSize}" x="${inset}" y="${h - inset - 2}">${label}</text>`,
  });
}

interface Slot {
  name: string;
  href: string;
  alt: string;
  share: number; // % of the README width
  mobileShare?: number;
  desktop: Tile[][];
  mobile: Tile[][];
}

const linkedin = (width: number, height: number) => link('linkedin', 'LinkedIn', width, height, color.blush, color.ink, 2.9, 'bottom');
const x = (width: number, height: number) => link('x', '@vastamaki', width, height, color.white, color.red, 3.1, 'right');

// Each slot is one image in the README, and one link. The intro restacks inside
// the image on phones, the middle row goes full width per image, and the bottom
// three swap to smaller versions of themselves.
const slots: Slot[] = [
  {
    name: 'intro',
    href: SITE,
    alt: "Hello! I'm Viljami, a software engineer from Finland. Welcome to the place where I break things.",
    share: 100,
    desktop: [[hello(), headline()]],
    mobile: [[hello()], [headline()]],
  },
  {
    name: 'about',
    href: SITE,
    alt: 'I build web apps end to end, from the database to the last pixel, and hunt bugs on the side. vastamaki.dev',
    share: 40,
    mobileShare: 100,
    desktop: [[about(340, 170)]],
    mobile: [[about(425, 170)]],
  },
  {
    name: 'details',
    href: GITHUB,
    alt: `Stack: Bun, TypeScript, PostgreSQL, Vite, React. ${total} contributions on GitHub since ${stats.since}.`,
    share: 60,
    mobileShare: 100,
    desktop: [[stack(255, 170), contributions(255, 170)]],
    mobile: [[stack(425, 136)], [contributions(425, 160)]],
  },
  {
    name: 'languages',
    href: `${GITHUB}?tab=repositories`,
    alt: `Mostly writing ${stats.languages.map((lang) => lang.name).join(', ')}`,
    share: 50,
    desktop: [[languages(425, 120)]],
    mobile: [[languages(212, 106)]],
  },
  {
    name: 'linkedin',
    href: 'https://www.linkedin.com/in/viljami-vastamaki',
    alt: 'LinkedIn',
    share: 25,
    desktop: [[linkedin(212, 120)]],
    mobile: [[linkedin(106, 106)]],
  },
  {
    name: 'x',
    href: 'https://x.com/vastamaki',
    alt: 'X: @vastamaki',
    share: 25,
    desktop: [[x(213, 120)]],
    mobile: [[x(106, 106)]],
  },
];

const assets = join(root, 'assets');
mkdirSync(assets, { recursive: true });
for (const file of readdirSync(assets)) {
  if (file.endsWith('.svg')) rmSync(join(assets, file));
}
for (const slot of slots) {
  writeFileSync(join(assets, `${slot.name}.svg`), sheet(slot.alt, slot.desktop));
  writeFileSync(join(assets, `${slot.name}-mobile.svg`), sheet(slot.alt, slot.mobile));
}

// No whitespace between the tags, or the images that share a row get a gap.
// Widths are slightly under the exact share, otherwise rounding can wrap the last one.
const readme = slots
  .map((slot) => {
    const width = slot.share === 100 ? 100 : slot.share - 0.03;
    const alt = slot.alt.replace(/"/g, '&quot;');
    const mobileWidth = slot.mobileShare ? ` width="${slot.mobileShare}%"` : '';
    return `<a href="${slot.href}"><picture><source media="${MOBILE}" srcset="./assets/${slot.name}-mobile.svg"${mobileWidth} /><img src="./assets/${slot.name}.svg" width="${width}%" alt="${alt}" /></picture></a>`;
  })
  .join('');

writeFileSync(join(root, 'README.md'), `<!-- Generated by scripts/bento.ts -->\n<p>\n${readme}\n</p>\n`);
console.log(`wrote ${slots.length * 2} images`);
