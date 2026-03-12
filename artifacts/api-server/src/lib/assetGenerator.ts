function generateHeroCitySVG(): string {
  const buildings = [
    { x: 0, y: 420, w: 60, h: 180, color: "#0a2a4a" },
    { x: 55, y: 360, w: 80, h: 240, color: "#0d3a5a" },
    { x: 130, y: 400, w: 50, h: 200, color: "#0a2a4a" },
    { x: 175, y: 320, w: 90, h: 280, color: "#0f4060" },
    { x: 260, y: 380, w: 60, h: 220, color: "#0a2a4a" },
    { x: 315, y: 280, w: 100, h: 320, color: "#133050" },
    { x: 410, y: 340, w: 70, h: 260, color: "#0d3a5a" },
    { x: 475, y: 300, w: 80, h: 300, color: "#0f4060" },
    { x: 550, y: 390, w: 55, h: 210, color: "#0a2a4a" },
    { x: 600, y: 250, w: 110, h: 350, color: "#133050" },
    { x: 705, y: 370, w: 65, h: 230, color: "#0d3a5a" },
    { x: 765, y: 320, w: 85, h: 280, color: "#0a2a4a" },
    { x: 845, y: 280, w: 95, h: 320, color: "#0f4060" },
    { x: 935, y: 360, w: 60, h: 240, color: "#0d3a5a" },
    { x: 990, y: 400, w: 70, h: 200, color: "#0a2a4a" },
    { x: 1055, y: 330, w: 80, h: 270, color: "#133050" },
    { x: 1130, y: 380, w: 70, h: 220, color: "#0a2a4a" },
  ];

  const windows: string[] = [];
  for (const b of buildings) {
    for (let wy = b.y + 15; wy < 590; wy += 22) {
      for (let wx = b.x + 8; wx < b.x + b.w - 10; wx += 16) {
        const lit = Math.random() > 0.45;
        const color = lit ? (Math.random() > 0.7 ? "#00fff7" : "#4a9eff") : "#0a1525";
        windows.push(`<rect x="${wx}" y="${wy}" width="8" height="10" fill="${color}" opacity="${lit ? 0.8 : 0.4}"/>`);
      }
    }
  }

  const gridLines: string[] = [];
  for (let x = 0; x <= 1200; x += 60) {
    gridLines.push(`<line x1="${x}" y1="0" x2="${x}" y2="600" stroke="#00fff7" stroke-width="0.3" opacity="0.06"/>`);
  }
  for (let y = 0; y <= 600; y += 60) {
    gridLines.push(`<line x1="0" y1="${y}" x2="1200" y2="${y}" stroke="#00fff7" stroke-width="0.3" opacity="0.06"/>`);
  }

  const buildingRects = buildings.map(b =>
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${600 - b.y}" fill="${b.color}"/>`
  ).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#020814"/>
      <stop offset="60%" stop-color="#060e20"/>
      <stop offset="100%" stop-color="#0a1428"/>
    </linearGradient>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a1428"/>
      <stop offset="100%" stop-color="#00fff7" stop-opacity="0.1"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="600" fill="url(#sky)"/>
  ${gridLines.join("\n")}
  ${buildingRects}
  ${windows.join("\n")}
  <rect x="0" y="590" width="1200" height="10" fill="url(#ground)"/>
  <text x="600" y="80" text-anchor="middle" font-family="monospace" font-size="48" fill="#00fff7" opacity="0.08" letter-spacing="16">SOFTWARE CITY</text>
  <circle cx="200" cy="120" r="2" fill="#00fff7" opacity="0.6"/>
  <circle cx="500" cy="80" r="1.5" fill="#4a9eff" opacity="0.8"/>
  <circle cx="800" cy="100" r="2" fill="#00fff7" opacity="0.5"/>
  <circle cx="1000" cy="60" r="1" fill="#ffffff" opacity="0.9"/>
  <circle cx="100" cy="50" r="1.5" fill="#4a9eff" opacity="0.7"/>
</svg>`;
}

function generateLogoSVG(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#020814"/>
      <stop offset="100%" stop-color="#0a1428"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#00fff7"/>
      <stop offset="100%" stop-color="#4a9eff"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" rx="16" fill="url(#bg)"/>
  <rect x="1" y="1" width="198" height="198" rx="16" fill="none" stroke="#00fff7" stroke-width="1.5" opacity="0.5"/>
  <rect x="20" y="130" width="28" height="50" fill="#0d3a5a" rx="2"/>
  <rect x="55" y="100" width="32" height="80" fill="#0f4060" rx="2"/>
  <rect x="94" y="80" width="30" height="100" fill="#133050" rx="2"/>
  <rect x="131" y="110" width="26" height="70" fill="#0d3a5a" rx="2"/>
  <rect x="163" y="125" width="22" height="55" fill="#0f4060" rx="2"/>
  <rect x="15" y="180" width="175" height="6" fill="url(#glow)" rx="1" opacity="0.8"/>
  <rect x="22" y="145" width="6" height="5" fill="#4a9eff" opacity="0.7" rx="1"/>
  <rect x="30" y="140" width="6" height="5" fill="#00fff7" opacity="0.6" rx="1"/>
  <rect x="58" y="115" width="7" height="5" fill="#4a9eff" opacity="0.7" rx="1"/>
  <rect x="67" y="120" width="7" height="5" fill="#00fff7" opacity="0.5" rx="1"/>
  <rect x="97" y="95" width="7" height="5" fill="#00fff7" opacity="0.8" rx="1"/>
  <rect x="106" y="100" width="7" height="5" fill="#4a9eff" opacity="0.6" rx="1"/>
  <text x="100" y="60" text-anchor="middle" font-family="monospace" font-size="11" fill="#00fff7" letter-spacing="3" opacity="0.9">SOFTWARE</text>
  <text x="100" y="76" text-anchor="middle" font-family="monospace" font-size="11" fill="#4a9eff" letter-spacing="3" opacity="0.9">CITY</text>
</svg>`;
}

export function getHeroCitySVG(): string {
  return generateHeroCitySVG();
}

export function getLogoSVG(): string {
  return generateLogoSVG();
}
