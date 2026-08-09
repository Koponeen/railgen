// Radan piirtotyylit yhtenä totuuden lähteenä. Samat säännöt menevät sekä
// elävään SVG:hen (<style> juuren sisällä) että PNG-vientiin, jossa ulkoinen
// tyylitiedosto ei ole käytettävissä.
//
// Visuaalinen kieli puulelusta (UI-linjaus 4): lämmin beige lauta, urat
// tummempina, aksenttina BRIO-punainen.

interface TrackPalette {
  floor: string
  floorEdge: string
  grid: string
  board: string
  boardEdge: string
  groove: string
  raised: string
  accent: string
}

const LIGHT: TrackPalette = {
  floor: '#ffffff',
  floorEdge: '#b7bdb4',
  grid: '#e4e8e0',
  board: '#e0c9a2',
  boardEdge: '#b8996c',
  groove: '#b8996c',
  raised: '#eedcbd',
  accent: '#c8102e',
}

const DARK: TrackPalette = {
  floor: '#20242a',
  floorEdge: '#3a3f47',
  grid: '#2a2e34',
  board: '#9c7f57',
  boardEdge: '#6d5638',
  groove: '#6d5638',
  raised: '#b89a70',
  accent: '#ff5a6e',
}

function rules(palette: TrackPalette): string {
  return `
.floor-border { fill: ${palette.floor}; stroke: ${palette.floorEdge}; stroke-width: 6; }
.grid-line { stroke: ${palette.grid}; stroke-width: 2; }
.piece-board { fill: none; stroke: ${palette.board}; stroke-width: 40; stroke-linecap: butt; stroke-linejoin: round; }
.piece-groove { fill: none; stroke: ${palette.groove}; stroke-width: 3; stroke-linecap: butt; opacity: 0.55; }
.piece.level-1 .piece-board { stroke: ${palette.raised}; }
.piece.level-1 .piece-groove { opacity: 0.4; }
.piece-buffer { stroke: ${palette.accent}; stroke-width: 7; stroke-linecap: round; }
.piece.selected .piece-board { stroke: ${palette.accent}; }
.piece.selected .piece-groove { stroke: ${palette.floor}; opacity: 0.5; }
.line.draft { fill: none; stroke: ${palette.accent}; stroke-width: 6; stroke-dasharray: 4 14; stroke-linecap: round; }
`
}

/** Näytölle: vaalea oletus, tumma `prefers-color-scheme`-perusteisesti (UI-linjaus 4). */
export function screenTrackCss(): string {
  return `${rules(LIGHT)}\n@media (prefers-color-scheme: dark) {${rules(DARK)}}`
}

/** Vientiin: aina vaalea, koska kuva päätyy paperille tai jaettavaksi. */
export function exportTrackCss(): string {
  return rules(LIGHT)
}
