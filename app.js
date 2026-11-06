/* ======================================================================
   MAQUETE 3D INTERATIVA — PRAÇA DA JUVENTUDE (Canabrava, Salvador/BA)
   Reconstrução fiel com base em dados reais:
   - OpenStreetMap (footprints de ginásio, campo, quadra, skate, ruas)
   - Imagem de satélite (muro, portaria, loop de caminhada, playground)
   Coordenadas: X = leste, Z = sul (Z = -norte), 1 unidade = 1 metro
   Av. Artêmio Castro Valente, 380-346 · Canabrava · Salvador/BA · 24 h
   ====================================================================== */
'use strict';

/* ----------------------------- Estado global -------------------------- */
let scene, camera, renderer;
let mode = 'orbital';
let locked = false;
let firstPerson = false;
let secOn = false, evacOn = false, roofOpaque = true, labelsOn = true;

let orbit = { theta: Math.PI, phi: 0.95, radius: 165, target: null };
let drag = false, lastMX = 0, lastMY = 0, dragDist = 0;

let labelsGroup, secGroup, evacGroup, conesGroup, barricadeGroup;
let gymRoofMats = [];
let pulseRings = [];
const AABBs = [];

const keys = {};
let yaw = Math.PI, pitch = 0, walkT = 0;
let avatar, avatarParts = {};
const avatarState = { x: 19, z: -42 };

const BOUND = { x1: -40, x2: 37.5, z1: -79, z2: 68.5 };
const WALK_SPEED = 5.2, RUN_SPEED = 9.5;

/* --------------- Controles de toque (celular / tablet) ------------------ */
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const touchMap = {};                       /* id de toque -> { type, lastX, lastY, dist } */
const joyVec = { x: 0, y: 0 };             /* joystick virtual: -1..1 */
let pinch = { active: false, startDist: 0, startRadius: 0 };
let pinchHappened = false;                 /* suprime o tap de incêndio no fim de uma pinça */

/* --------------------------------- Setup ------------------------------ */
const container = document.getElementById('app');
camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1200);
orbit.target = new THREE.Vector3(0, 1, -5);

renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.75 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3ef);
scene.fog = new THREE.Fog(0x9fd3ef, 300, 900);

/* Luzes */
scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x6b7a5a, 0.85));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.05);
sun.position.set(-70, 120, -60);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
sun.shadow.camera.left = -160; sun.shadow.camera.right = 160;
sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
sun.shadow.camera.far = 420;
sun.shadow.bias = -0.0006;
scene.add(sun);

/* Grupos de camadas */
labelsGroup = new THREE.Group(); scene.add(labelsGroup);
secGroup = new THREE.Group();   scene.add(secGroup);
evacGroup = new THREE.Group();  scene.add(evacGroup);
conesGroup = new THREE.Group(); scene.add(conesGroup);
barricadeGroup = new THREE.Group(); scene.add(barricadeGroup);

/* ------------------------------ Helpers ------------------------------- */
function matL(color, opts) {
  opts = opts || {};
  const m = new THREE.MeshLambertMaterial({ color: color });
  if (opts.transparent) { m.transparent = true; m.opacity = opts.opacity !== undefined ? opts.opacity : 0.5; }
  if (opts.emissive) m.emissive = new THREE.Color(opts.emissive);
  if (opts.side) m.side = opts.side;
  return m;
}
function addBox(parent, w, h, d, color, x, y, z, opts) {
  opts = opts || {};
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matL(color, opts));
  m.position.set(x, y, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  m.castShadow = opts.cast !== false;
  m.receiveShadow = true;
  (parent || scene).add(m);
  return m;
}
function addCyl(parent, rt, rb, h, color, x, y, z, opts) {
  opts = opts || {};
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, opts.seg || 12), matL(color, opts));
  m.position.set(x, y, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.rz) m.rotation.z = opts.rz;
  if (opts.ry) m.rotation.y = opts.ry;
  m.castShadow = true;
  m.receiveShadow = true;
  (parent || scene).add(m);
  return m;
}
function addRing(parent, rIn, rOut, color, x, z, y, opts) {
  opts = opts || {};
  const m = new THREE.Mesh(
    new THREE.RingGeometry(rIn, rOut, 40),
    matL(color, { transparent: true, opacity: opts.opacity !== undefined ? opts.opacity : 0.9, side: THREE.DoubleSide })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y || 0.06, z);
  (parent || scene).add(m);
  return m;
}
/* Faixa reta entre dois pontos (p/ ruas e caminhos) */
function addRibbon(x1, z1, x2, z2, w, color, y) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return null;
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(len, 0.06, w),
    matL(color, {})
  );
  m.position.set((x1 + x2) / 2, y || 0.05, (z1 + z2) / 2);
  m.rotation.y = -Math.atan2(dz, dx);
  m.castShadow = false;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

/* ---------- Miniterreno texturizado (ruído procedural — realismo) ------- */
const texCache = {};
function noiseTex(kind) {
  if (texCache[kind]) return texCache[kind];
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const base = { grass: 238, clay: 244, sand: 246, asphalt: 236, concrete: 242, rubber: 244, track: 244 }[kind] || 240;
  ctx.fillStyle = 'rgb(' + base + ',' + base + ',' + base + ')';
  ctx.fillRect(0, 0, 128, 128);
  const density = { grass: 950, clay: 750, sand: 520, asphalt: 1300, concrete: 520, rubber: 850, track: 750 }[kind] || 600;
  for (let i = 0; i < density; i++) {
    const x = Math.random() * 128, yy = Math.random() * 128;
    const kk = Math.random();
    const v = Math.floor((base - 26) + kk * 40);
    ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
    if (kind === 'grass') ctx.fillRect(x, yy, 1.5, 2.8);
    else ctx.fillRect(x, yy, 1.4, 1.4);
  }
  if (kind === 'sand') {
    ctx.strokeStyle = 'rgba(205,195,170,0.5)';
    ctx.lineWidth = 1;
    for (let y = 6; y < 128; y += 12) {
      ctx.beginPath();
      for (let x = 0; x <= 128; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.2) * 2);
      ctx.stroke();
    }
  }
  if (kind === 'concrete') {
    ctx.strokeStyle = 'rgba(150,150,150,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(128, 62); ctx.stroke();
  }
  if (kind === 'clay') {
    ctx.strokeStyle = 'rgba(200,170,140,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * 128, Math.random() * 128);
      ctx.lineTo(Math.random() * 128, Math.random() * 128);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache[kind] = t;
  return t;
}
function addGround(w, d, x, z, kind, tint, y) {
  const t = noiseTex(kind).clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(Math.max(1, Math.round(w / 5)), Math.max(1, Math.round(d / 5)));
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.06, d),
    new THREE.MeshLambertMaterial({ map: t, color: tint })
  );
  m.position.set(x, y || 0.07, z);
  m.castShadow = false;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
/* Deslocamento de polígono (para a pista perimetral do complexo) */
function offsetPoly(pts, off) {
  const n = pts.length;
  let cx2 = 0, cz2 = 0;
  pts.forEach(function (p) { cx2 += p[0]; cz2 += p[1]; });
  cx2 /= n; cz2 /= n;
  function offEdge(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const d = { x: dx / len, z: dz / len };
    let nx = -d.z, nz = d.x;
    const mx = (a.x + b.x) / 2 - cx2, mz = (a.z + b.z) / 2 - cz2;
    /* normal p/ DENTRO do polígono (off positivo desloca o vértice p/ o interior) */
    if (nx * mx + nz * mz > 0) { nx = -nx; nz = -nz; }
    return { a: a, d: d, nx: nx, nz: nz };
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const eA = offEdge({ x: p0[0], z: p0[1] }, { x: p1[0], z: p1[1] });
    const eB = offEdge({ x: p1[0], z: p1[1] }, { x: p2[0], z: p2[1] });
    const a = { x: eA.a.x + eA.nx * off, z: eA.a.z + eA.nz * off };
    const d = eA.d;
    const q = { x: eB.a.x + eB.nx * off, z: eB.a.z + eB.nz * off };
    const e = eB.d;
    const den = d.x * e.z - d.z * e.x;
    let ip;
    if (Math.abs(den) < 1e-6) { ip = { x: q.x, z: q.z }; }
    else {
      const t = ((q.x - a.x) * e.z - (q.z - a.z) * e.x) / den;
      ip = { x: a.x + d.x * t, z: a.z + d.z * t };
    }
    out.push([ip.x, ip.z]);
  }
  return out;
}

/* Rótulos (sprites de texto flutuantes) — auto-encaixe no tamanho da caixa */
function makeLabel(text, x, y, z, o) {
  o = o || {};
  text = String(text);
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = o.bg || 'rgba(10,18,32,0.85)';
  const r = 18;
  ctx.beginPath();
  ctx.moveTo(4 + r, 4); ctx.lineTo(508 - r, 4); ctx.quadraticCurveTo(508, 4, 508, 4 + r);
  ctx.lineTo(508, 124 - r); ctx.quadraticCurveTo(508, 124, 508 - r, 124);
  ctx.lineTo(4 + r, 124); ctx.quadraticCurveTo(4, 124, 4, 124 - r);
  ctx.lineTo(4, 4 + r); ctx.quadraticCurveTo(4, 4, 4 + r, 4);
  ctx.closePath(); ctx.fill();
  /* quebra em até 2 linhas equilibradas e reduz a fonte até caber */
  const maxW = 468;
  let font = o.font || 44;
  let lines = [text];
  function setFont() { ctx.font = 'bold ' + font + 'px Arial'; }
  setFont();
  if (ctx.measureText(text).width > maxW) {
    const words = text.split(' ');
    let bestK = 1, bestW = 1e9;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' '), b = words.slice(k).join(' ');
      const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (w < bestW) { bestW = w; bestK = k; }
    }
    lines = [words.slice(0, bestK).join(' '), words.slice(bestK).join(' ')];
    while (Math.max(ctx.measureText(lines[0]).width, ctx.measureText(lines[1]).width) > maxW && font > 16) {
      font -= 2;
      setFont();
    }
  }
  ctx.fillStyle = o.color || '#ffffff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 256, lines.length === 1 ? 66 : (i === 0 ? 46 : 86));
  }
  const tex = new THREE.CanvasTexture(canvas);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  const wMeters = o.w || 13;
  sp.scale.set(wMeters, wMeters * 0.25, 1);
  sp.position.set(x, y, z);
  sp.renderOrder = 999;
  (o.parent || labelsGroup).add(sp);
  return sp;
}

/* Pin de segurança: anel pulsante + haste */
function makeMarker(x, z, color) {
  const ring = addRing(secGroup, 1.8, 2.6, color, x, z, 0.12, { opacity: 0.9 });
  pulseRings.push(ring);
  addCyl(secGroup, 0.09, 0.09, 3.4, color, x, 1.7, z, { seg: 8, emissive: color });
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), new THREE.MeshBasicMaterial({ color: color }));
  top.position.set(x, 3.6, z);
  secGroup.add(top);
  return ring;
}

/* ======================================================================
   TERRENO — base regional (satélite: mata a oeste/sul, campo aberto)
   ====================================================================== */
addGround(700, 560, -60, -40, 'grass', 0x7ea258, 0);                 // terreno geral (textura grama)

/* Gramado interno do parque — polígono OSM real de "Praça da Juventude" */
(function parkGrass() {
  const pts = [        // (x, norte) — shape + rot -90° => mundo (x, -norte)
    [-38.3, 41.8], [-41.0, -69.7], [29.3, -67.8], [38.9, 68.1], [29.7, 82.4], [0.7, 58.5]
  ];
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const m = new THREE.Mesh(geo, matL(0x5e9144, {}));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.receiveShadow = true;
  scene.add(m);
})();

/* Acesso norte: apron de pedrisco entre muro e rua (visível no satélite) */
  addGround(34, 26, 12, -70, 'asphalt', 0x9fa79a, 0.06);              // apron texturizado

/* ======================================================================
   RUAS REAIS (geometria OSM)
   ====================================================================== */
const ASPHALT = 0x4a4f57;
const SIDEWALK = 0xb8bcc2;

/* Av. Artêmio Castro Valente — via expressa paralela ao Barradão (2 pistas) */
(function avCastroValente() {
  const pistaA = [[-178, -248.2], [-169, -226.9], [-148.3, -185.8], [-125.3, -152.9], [-112.6, -140.2],
    [-87.2, -122.7], [-58.3, -107.3], [-23.1, -96.7], [-5.4, -95], [22.3, -92.3], [34.8, -93.3],
    [68.1, -95.8], [121, -100.2], [148.9, -102.5], [217, -107.1]];
  const pistaB = [[267.6, -134.9], [255.8, -130.5], [247.1, -128], [238.3, -125.4], [229.7, -122.9],
    [173.8, -115], [125.6, -111.5], [92.3, -108.6], [61.3, -104.9], [33.2, -103.2], [16.2, -102.5],
    [1.8, -102.6], [-7, -103.6], [-19.4, -106.6]];
  for (let i = 0; i < pistaA.length - 1; i++) {
    addRibbon(pistaA[i][0], pistaA[i][1], pistaA[i + 1][0], pistaA[i + 1][1], 8, ASPHALT, 0.04);
  }
  for (let i = 0; i < pistaB.length - 1; i++) {
    addRibbon(pistaB[i][0], pistaB[i][1], pistaB[i + 1][0], pistaB[i + 1][1], 7, ASPHALT, 0.04);
  }
  /* refletivos: linha central amarela alternada (aprox.) */
  for (let i = 0; i < pistaA.length - 1; i += 2) {
    addRibbon(pistaA[i][0], pistaA[i][1], pistaA[i + 1][0], pistaA[i + 1][1], 0.3, 0xd9c33c, 0.08);
  }
})();

/* Rua Flor de Maracujá (contorno oeste, com garagem de rua no trecho NE) */
(function ruaFlor() {
  const pts = [[2.1, -64], [-5.5, -60], [-14.3, -57], [-21.6, -55.7], [-29.9, -56.4], [-46.7, -58.6],
    [-88.6, -66.4], [-97.8, -66.9], [-106.1, -65.4], [-113.6, -63.1], [-121.5, -58.9],
    [-149.2, -39.1], [-213.8, 5.1], [-281.8, 47.7], [-311.7, 66.4], [-341.4, 81.4], [-374.7, 89.4], [-392, 91.3]];
  for (let i = 0; i < pts.length - 1; i++) {
    addRibbon(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 6.5, ASPHALT, 0.04);
  }
  /* trecho NE: garagem/garagem de rua na lateral da praça */
  addRibbon(2.1, -64, 1.7, -85, 6, ASPHALT, 0.04);
  addRibbon(1.7, -85, 19.8, -80.5, 6, ASPHALT, 0.04);
  addRibbon(19.8, -80.5, 34.8, -93.3, 6, ASPHALT, 0.04);
  /* calçada interna em frente ao muro norte */
  addRibbon(-2, -55.5, 19, -52.5, 2.5, SIDEWALK, 0.07);
})();

/* Estacionamento de rua (carros visíveis no satélite) */
(function streetCars() {
  const cols = [0xc23b4a, 0x24466b, 0xd4d7db, 0x2f6f4f, 0x8f9aa6, 0xb97324, 0x555b66, 0x8e3b52];
  for (let i = 0; i < 8; i++) {
    const z = -65 - i * 3.1;
    const x = -8.5 + (i % 2) * 1.5;
    addBox(null, 4.2, 1.1, 1.9, cols[i], x, 0.65, z);
    addBox(null, 2.2, 0.75, 1.7, 0x31465c, x, 1.5, z);
  }
})();

/* ======================================================================
   MURO PERIMETRAL (alvenaria, ~2,2 m) — contorno real do cercado
   Vértices: A(-41,-44) B(8,-47) [GAP E1 x16.5..21.5] C(21.5,-48) D(30,-49)
             E(38.9,-68.1) F(29.3,67.8) [GAP E2 x-2.2..2.2] G(-41,69.7)
   ====================================================================== */
const WALL_C = 0xc4a48a, WALL_TOP = 0xd8c2ab, PILLAR = 0xb08d6f;
(function walls() {
    const H = 2.2, T = 0.4, Y = H / 2 + 0.05;
    function wallSeg(x1, z1, x2, z2) {
      const w = Math.abs(x2 - x1), d = Math.abs(z2 - z1);
      addBox(null, w > 0.1 ? w : T, H, d > 0.1 ? d : T, WALL_C, (x1 + x2) / 2, Y, (z1 + z2) / 2);
      addBox(null, w > 0.1 ? w : T + 0.15, 0.15, d > 0.1 ? d : T + 0.15, WALL_TOP, (x1 + x2) / 2, H + 0.1, (z1 + z2) / 2);
    }
    /* trecho inclinado do muro (borda leste do OSM: F(29.4,68.1) → E(38.9,-68.1)) */
    function wallSlant(x1, z1, x2, z2) {
      const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, H, T), matL(WALL_C, {}));
      m.position.set((x1 + x2) / 2, Y, (z1 + z2) / 2);
      m.rotation.y = -Math.atan2(dz, dx);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 0.15, T + 0.15), matL(WALL_TOP, {}));
      cap.position.set((x1 + x2) / 2, H + 0.1, (z1 + z2) / 2);
      cap.rotation.y = m.rotation.y;
      scene.add(cap);
    }
    wallSeg(-41.2, -44, -41.2, 69.7);          // oeste (A→G)
    wallSeg(-41.2, 69.7, -2.2, 68.8);          // sul oeste (G→gap E2)
    wallSeg(2.2, 67.6, 29.4, 68.3);            // sul leste (gap E2→F)
    wallSlant(38.9, -68.1, 29.4, 68.1);        // leste inclinado (E→F, borda OSM)
    wallSlant(30, -49, 38.9, -68.1);           // NE diagonal (D→E)
    wallSeg(-41.2, -43.6, 8, -47);             // norte A→B
    wallSeg(8, -47, 16.2, -47.7);              // B→gap E1
    wallSeg(21.8, -48, 30, -49);               // gap E1→D
  /* pilares a cada ~12 m */
  const pillarXZ = [[-41.2, -44], [-41.2, -14], [-41.2, 16], [-41.2, 44], [-41.2, 69.7],
    [-14, 69], [12, 68.3], [29.4, 68.1], [29.4, 30], [29.4, -10], [29.4, -49],
    [34.3, -58.6], [8, -47], [21.5, -48], [30, -49]];
  pillarXZ.forEach(function (p) {
    addBox(null, 0.85, 2.55, 0.85, PILLAR, p[0], 1.32, p[1]);
  });
  /* guarda-corpo dos portões */
  addBox(null, 0.9, 3.2, 0.9, PILLAR, 16.5, 1.6, -47.7);
  addBox(null, 0.9, 3.2, 0.9, PILLAR, 21.5, 1.6, -48);
  addBox(null, 4.6, 0.35, 0.35, 0x39586e, 19, 3.1, -47.85);
  addBox(null, 3.4, 2.1, 0.15, 0x7c94a8, 18.2, 1.1, -47.8, { transparent: true, opacity: 0.55 }); // grade E1 meio aberta
  addBox(null, 0.9, 3.2, 0.9, PILLAR, -2.2, 1.6, 68.9);
  addBox(null, 0.9, 3.2, 0.9, PILLAR, 2.2, 1.6, 68.6);
  addBox(null, 0.35, 0.35, 4.9, 0x39586e, 0, 3.05, 68.7);
})();

/* Colisões: muro */
AABBs.push({ x1: -41.8, x2: -40.6, z1: -44.6, z2: 70.2 });      // oeste
AABBs.push({ x1: -41.8, x2: -2.2, z1: 67.3, z2: 70.3 });        // sul oeste
AABBs.push({ x1: 2.2, x2: 29.8, z1: 67.2, z2: 68.9 });          // sul leste
AABBs.push({ x1: 34.9, x2: 39.6, z1: -68.6, z2: -1 });          // leste inclinado (norte)
AABBs.push({ x1: 28.9, x2: 36.4, z1: -1, z2: 68.4 });           // leste inclinado (sul)
AABBs.push({ x1: 29.4, x2: 39.4, z1: -68.6, z2: -48.5 });       // NE diagonal
AABBs.push({ x1: -41.8, x2: 8.2, z1: -47.8, z2: -43.2 });       // norte A→B
AABBs.push({ x1: 8.2, x2: 16.2, z1: -48.3, z2: -47.2 });        // até gap
AABBs.push({ x1: 21.8, x2: 30.4, z1: -49.5, z2: -47.6 });       // pós gap

/* ======================================================================
   PORTARIA (cabine laranja no acesso norte — visível no satélite)
   ====================================================================== */
(function portaria() {
  addBox(null, 3.6, 2.9, 2.8, 0xd4682a, 15.5, 1.5, -74);
  addBox(null, 4.2, 0.3, 3.4, 0x9c4a1e, 15.5, 3.05, -74);
  addBox(null, 1.2, 1.1, 0.12, 0x27313d, 15.5, 1.7, -75.45);     // janela
  /* faixa de pedestres + cancela no acesso à Rua Flor de Maracujá */
  makeLabel('PORTARIA — ACESSO PRINCIPAL', 15.5, 5.6, -74, { color: '#ffd8a8', w: 10 });
  AABBs.push({ x1: 13.5, x2: 17.5, z1: -75.7, z2: -72.3 });
})();
/* cancela dinâmica (só visual sempre levantada) */
addBox(null, 3.4, 0.12, 0.12, 0xd23c3c, 18.6, 1.1, -71.5, { rz: 0.35 });

/* ======================================================================
   ESTACIONAMENTO (apron norte — area x -3..27, z -83..-57 do satélite)
   2 fileiras de vagas demarcadas + corredor central + carros + placa P
   ====================================================================== */
(function parking() {
  const LINE = 0xe8e2d2;
  /* divisórias das vagas: 2 fileiras (norte z -66 / sul z -74), vagas a cada 2.65 m */
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i <= 12; i++) {
      const x = -3.4 + i * 2.65;
      addBox(null, 0.14, 0.02, 4.4, LINE, x, 0.1, row === 0 ? -66.4 : -73.6, { cast: false });
    }
  }
  /* vagas PCD + cor amarela junto à borda leste */
  addBox(null, 0.14, 0.02, 4.4, 0xf2c230, 28.85, 0.1, -66.4, { cast: false });
  addBox(null, 1.9, 0.02, 0.14, 0xf2c230, 27.9, 0.1, -64.2, { cast: false });
  addBox(null, 1.9, 0.02, 0.14, 0xf2c230, 27.9, 0.1, -68.6, { cast: false });
  /* corredor central pintado */
  addBox(null, 31, 0.02, 0.14, 0xd8d2c0, 11.8, 0.1, -70, { cast: false });
  /* placa P elevada na entrada */
  addBox(null, 0.12, 2.4, 0.12, 0x3a4654, 10.5, 1.2, -71.6);
  addBox(null, 1.05, 1.05, 0.1, 0x1d5aa8, 10.5, 2.4, -71.6);
  makeLabel('P', 10.5, 3.4, -71.6, { w: 1.9, color: '#ffffff', bg: 'rgba(0,0,0,0)', font: 96 });
  /* carros estacionados nas vagas (padrão satélite; evita caminho de pedestres x17..21,5 e portaria) */
  const pcols = [0xc23b4a, 0x24466b, 0xd4d7db, 0x2f6f4f, 0x8f9aa6, 0xb97324, 0x8e3b52, 0x31465c, 0x8a8f98, 0x6b4d3a, 0x39586e];
  const stalls = [[-2.1, -66.4], [3.2, -66.4], [5.9, -66.4], [12, -66.4], [14.6, -66.4], [23.5, -66.4],
                  [-2.1, -73.6], [3.2, -73.6], [5.9, -73.6], [21.8, -73.6], [24.5, -73.6]];
  stalls.forEach(function (s, i) {
    addBox(null, 4.2, 1.1, 1.9, pcols[i % pcols.length], s[0], 0.6, s[1], { ry: Math.PI / 2 });
    addBox(null, 2.2, 0.75, 1.7, 0x31465c, s[0], 1.45, s[1], { ry: Math.PI / 2 });
  });
  makeLabel('ESTACIONAMENTO', 12, 4.6, -70, { w: 10, color: '#dbe7f5' });
})();

/* caminho de acesso norte (sem pavimento interno: pedrisco) */
addRibbon(19, -48, 19, -62, 4, 0xa3aa9d, 0.07);
addRibbon(19, -62, 19.5, -79.5, 4, 0xa3aa9d, 0.07);

/* ======================================================================
   GINÁSIO POLIESPORTIVO COBERTO (37,5 × 26,2 m — footprint OSM real)
   Telhado de duas águas cinza, base em alvenaria clara + pano translúcido
   ====================================================================== */
(function gym() {
  const x1 = -30.8, x2 = 6.7, zN = -20.3, zS = 5.9;   // bordas em Z
  const cx = -12.05, cz = -7.2, H = 7;
  const wallTrans = { transparent: true, opacity: 0.38, side: THREE.DoubleSide };
  function wallZ(zFix, a, b) {                         // parede paralela ao eixo X
    const len = Math.abs(b - a);
    addBox(null, len, H, 0.3, 0x9fc5e0, (a + b) / 2, 1.25 + (H - 1.25) / 2, zFix, wallTrans);
    addBox(null, len, 1.25, 0.35, 0xd6cfc2, (a + b) / 2, 0.62, zFix);
  }
  function wallX(xFix, a, b) {                         // parede paralela ao eixo Z
    const len = Math.abs(b - a);
    addBox(null, 0.3, H, len, 0x9fc5e0, xFix, 1.25 + (H - 1.25) / 2, (a + b) / 2, wallTrans);
    addBox(null, 0.35, 1.25, len, 0xd6cfc2, xFix, 0.62, (a + b) / 2);
  }
  wallZ(zN, x1, x2);                                   // face norte (fechada)
  wallZone(zS);                                        // face sul com vão de porta
  wallX(x1, zN, zS);                                   // oeste
  wallX(x2, zN, zS);                                   // leste
  function wallZone(zFix) {                            /* face sul: 2 panos + vão 4 m (x -16.4..-12.4) */
    wallZ(zFix, x1, -16.4);
    wallZ(zFix, -12.4, x2);
  }
  /* porta principal aberta com painéis laterais → dá para ENTRAR no ginásio */
  addBox(null, 0.16, 2.7, 0.14, 0x39586e, -16.5, 1.35, zS + 0.15);
  addBox(null, 0.16, 2.7, 0.14, 0x39586e, -12.3, 1.35, zS + 0.15);
  addBox(null, 2.1, 0.08, 0.06, 0x39586e, -15.45, 2.68, zS + 0.15);  // dintel
  const doorP1 = addBox(null, 1.9, 2.55, 0.06, 0x2e6cb8, -17.35, 1.3, zS + 0.7);
  doorP1.rotation.y = -1.15;                           // painel aberto p/ dentro
  const doorP2 = addBox(null, 1.9, 2.55, 0.06, 0x2e6cb8, -11.45, 1.3, zS + 0.7);
  doorP2.rotation.y = 1.15;
  /* tapete de boas-vindas no vão */
  addBox(null, 3.9, 0.02, 1.2, 0x51606e, -14.4, 0.12, zS + 0.6, { cast: false });
  /* pilares internos */
  addCyl(null, 0.28, 0.28, H, 0xe4e7eb, x1 + 1.8, H / 2, zN + 1.8, { seg: 10 });
  addCyl(null, 0.28, 0.28, H, 0xe4e7eb, x2 - 1.8, H / 2, zN + 1.8, { seg: 10 });
  addCyl(null, 0.28, 0.28, H, 0xe4e7eb, x1 + 1.8, H / 2, zS - 1.8, { seg: 10 });
  addCyl(null, 0.28, 0.28, H, 0xe4e7eb, x2 - 1.8, H / 2, zS - 1.8, { seg: 10 });
  /* piso interno (quadra) */
  addBox(null, 35, 0.05, 23.8, 0xa8794f, cx, 0.08, cz, { cast: false });
  addRing(null, 1.8, 2.1, 0xffffff, cx, cz, 0.14, { opacity: 0.9 });
  addBox(null, 29, 0.03, 0.35, 0xffffff, cx, 0.14, cz, { cast: false });
  addBox(null, 0.35, 0.03, 21, 0xffffff, cx, 0.14, cz - 9.6, { cast: false });
  addBox(null, 0.35, 0.03, 21, 0xffffff, cx, 0.14, cz + 9.6, { cast: false });
  /* telhado de duas águas — crista E-W */
  const halfD = (zS - zN) / 2 + 1.2;                   // leste-oeste extensão em Z
  const slope = Math.atan2(3.4, halfD - 0.8);
  const roofOpts = { transparent: true, opacity: 1, side: THREE.DoubleSide };
  const sl1 = addBox(null, (x2 - x1) + 3, 0.35, halfD, 0x6b7480, cx, H + 1.6, cz - halfD / 2 + 0.5, roofOpts);
  const sl2 = addBox(null, (x2 - x1) + 3, 0.35, halfD, 0x6b7480, cx, H + 1.6, cz + halfD / 2 - 0.5, roofOpts);
  sl1.rotation.x = -slope;
  sl2.rotation.x = slope;
  gymRoofMats.push(sl1.material, sl2.material);
  addBox(null, (x2 - x1) + 4, 0.55, 0.9, 0x4b545e, cx, H + 3.6, cz);  // crista
  makeLabel('GINÁSIO POLIESPORTIVO COBERTO', cx, H + 9.5, cz, { w: 16 });  // rótulo completo bem acima do telhado
  /* colisão em 4 segmentos (deixa a porta x -16.4..-12.4 livre para entrar) */
  AABBs.push({ x1: x1 - 0.4, x2: x2 + 0.4, z1: zN - 0.4, z2: zN + 0.4 });  // norte
  AABBs.push({ x1: x1 - 0.4, x2: -16.4, z1: zS - 0.4, z2: zS + 0.4 });     // sul oeste
  AABBs.push({ x1: -12.4, x2: x2 + 0.4, z1: zS - 0.4, z2: zS + 0.4 });     // sul leste
  AABBs.push({ x1: x1 - 0.4, x2: x1 + 0.4, z1: zN - 0.4, z2: zS + 0.4 });  // oeste
  AABBs.push({ x1: x2 - 0.4, x2: x2 + 0.4, z1: zN - 0.4, z2: zS + 0.4 });  // leste
})();

/* ======================================================================
   BLOCO DE VESTIÁRIOS E SALAS DE APOIO (anexo L — footprint OSM)
   ====================================================================== */
(function annex() {
  const c = 0xb9bdc2, par = 0x8d939c;
  /* norte: 6.9..21.7 × z -18.6..-12.6 */
  addBox(null, 14.8, 5.5, 6.0, c, 14.3, 2.75, -15.6);
  addBox(null, 15.0, 0.5, 6.2, par, 14.3, 5.75, -15.6);
  /* meio: 6.3..15.0 × z -12.6..0.3 */
  addBox(null, 8.7, 5.5, 12.9, c, 10.65, 2.75, -6.15);
  addBox(null, 8.9, 0.5, 13.1, par, 10.65, 5.75, -6.15);
  /* sul: 6.3..19.7 × z 0.3..7.5 */
  addBox(null, 13.4, 5.5, 7.2, c, 13.0, 2.75, 3.9);
  addBox(null, 13.6, 0.5, 7.4, par, 13.0, 5.75, 3.9);
  /* caixas d'água e ar-condicionado no topo */
  addCyl(null, 1.0, 1.0, 1.6, 0x2f6fbd, 9, 6.8, -3, { seg: 14 });
  addCyl(null, 0.9, 0.9, 1.5, 0x2f6fbd, 12, 6.75, 4.5, { seg: 14 });
  addBox(null, 1.6, 0.9, 1.2, 0x7c828a, 17, 6.2, -15.4);
  /* porta para o pátio */
  addBox(null, 2.4, 2.3, 0.15, 0x39586e, 8, 1.15, 7.58);
  makeLabel('VESTIÁRIOS E SALAS DE APOIO', 14, 10, -14, { w: 13 });
  AABBs.push({ x1: 6.4, x2: 22.2, z1: -19.1, z2: -12.1 });
  AABBs.push({ x1: 5.8, x2: 15.4, z1: -13.1, z2: 0.8 });
  AABBs.push({ x1: 5.8, x2: 20.2, z1: -0.2, z2: 8 });
})();

/* ======================================================================
   CAMPO DE FUTEBOL SOCIETY (28 × 48 m — terra batida, satélite+OSM)
   ====================================================================== */
(function soccerField() {
  const x1 = -23.7, x2 = 4.4, z1 = 11.6, z2 = 59.7;     // norte→sul em Z
  addGround(x2 - x1, z2 - z1, (x1 + x2) / 2, (z1 + z2) / 2, 'clay', 0x9c6b4d, 0.07); // piso texturizado terra
  const g = new THREE.Group(); scene.add(g);
  const L = 0.32, cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  addBox(g, x2 - x1, 0.03, L, 0xf3ede2, cx, 0.15, z1 + L / 2, { cast: false });
  addBox(g, x2 - x1, 0.03, L, 0xf3ede2, cx, 0.15, z2 - L / 2, { cast: false });
  addBox(g, L, 0.03, z2 - z1, 0xf3ede2, x1 + L / 2, 0.15, cz, { cast: false });
  addBox(g, L, 0.03, z2 - z1, 0xf3ede2, x2 - L / 2, 0.15, cz, { cast: false });
  addBox(g, L, 0.03, z2 - z1, 0xf3ede2, cx, 0.15, cz, { cast: false });
  addRing(g, 3, 3.5, 0xf3ede2, cx, cz, 0.16, { opacity: 0.95 });
  addBox(g, 7, 0.03, 13, 0xf3ede2, cx, 0.15, z1 + 6.7, { cast: false });      // grande área norte
  addBox(g, 7, 0.03, 13, 0xf3ede2, cx, 0.15, z2 - 6.7, { cast: false });      // grande área sul
  function goal(z) {
    const G = 0xf5f5f0;
    addCyl(null, 0.07, 0.07, 2.0, G, cx - 3.4, 1, z, { seg: 8 });
    addCyl(null, 0.07, 0.07, 2.0, G, cx + 3.4, 1, z, { seg: 8 });
    addBox(null, 7, 0.09, 0.09, G, cx, 2, z);
  }
  goal(z1 + 0.4); goal(z2 - 0.4);
  makeLabel('CAMPO DE FUTEBOL SOCIETY (TERRA BATIDA)', cx, 7, cz, { w: 15, color: '#fde8cf' });
})();

/* ======================================================================
   QUADRAS DE AREIA — SÃO 2, LADO A LADO NO MESMO TERRENO (12,4 × 23,9 m — OSM)
   Cada meia-quadra (norte e sul) tem a própria rede + números externos.
   Avatares e visitantes andam e ENTRAM nas quadras (sem colisão).
   ====================================================================== */
(function sandCourts() {
  const x1 = 11.4, x2 = 23.8, z1 = 24.7, z2 = 48.6;
  addGround(x2 - x1, z2 - z1, (x1 + x2) / 2, (z1 + z2) / 2, 'sand', 0xd8c9a3, 0.08);
  /* divisória de terra central entre as 2 quadras */
  addBox(null, x2 - x1, 0.02, 0.9, 0xb9a97f, (x1 + x2) / 2, 0.16, 36.65, { cast: false });
  function net(mz, num, sign) {                            /* rede E-W da meia-quadra */
    addCyl(null, 0.07, 0.07, 2.4, 0xf0f0ee, x1 + 0.3, 1.2, mz, { seg: 8 });
    addCyl(null, 0.07, 0.07, 2.4, 0xf0f0ee, x2 - 0.3, 1.2, mz, { seg: 8 });
    addBox(null, x2 - x1 - 0.6, 2.0, 0.06, 0xffffff, (x1 + x2) / 2, 1.4, mz, { transparent: true, opacity: 0.5, cast: false });
    /* placa externa com número de cada quadra */
    addBox(null, 1.6, 1.1, 0.08, 0x1d5aa8, x1 - 1.5, 0.62, mz - 4.4);
    makeLabel(sign, x1 - 1.5, 1.7, mz - 4.4, { w: 3.6, font: 26 });
  }
  net(30.65, 1, 'QUADRA DE AREIA 1');
  net(42.65, 2, 'QUADRA DE AREIA 2');
  makeLabel('QUADRA DE AREIA 1 · FUTEVÔLEI/VÔLEI (NORTE)', (x1 + x2) / 2, 6.8, 30.65, { w: 12, color: '#fdf3d0' });
  makeLabel('QUADRA DE AREIA 2 · FUTEVÔLEI/VÔLEI (SUL)', (x1 + x2) / 2, 6.8, 42.65, { w: 12, color: '#fdf3d0' });
})();

/* ======================================================================
   PISTA DE SKATE (25 × 13,5 m — concrete, OSM)
   ====================================================================== */
(function skate() {
  const cx = -15.5, cz = -30.25;
  addGround(25.2, 13.5, cx, cz, 'concrete', 0x9aa1a8, 0.09);
  addBox(null, 1.5, 0.5, 12, 0x858c93, cx - 11.2, 1.35, cz, { rx: -0.55 });   // quarterpipe oeste
  addBox(null, 1.5, 0.5, 12, 0x858c93, cx + 11.2, 1.35, cz, { rx: 0.55 });    // quarterpipe leste
  addBox(null, 13, 0.5, 1.5, 0x858c93, cx, 1.35, cz - 5.6, { rz: 0.55 });     // quarterpipe norte
  const fun = addCyl(null, 3, 3, 1.5, 0x8f969d, cx + 1, 0.85, cz + 1.8, { seg: 4 });
  fun.rotation.y = Math.PI / 4;
  addCyl(null, 0.08, 0.08, 5.5, 0xd23f3f, cx - 4, 1.1, cz - 2.5, { rz: Math.PI / 2 });
  addCyl(null, 0.09, 0.09, 1.1, 0xd23f3f, cx - 6.4, 0.6, cz - 2.5);
  addCyl(null, 0.09, 0.09, 1.1, 0xd23f3f, cx - 1.6, 0.6, cz - 2.5);
  makeLabel('PISTA DE SKATE — 25×13,5 m', cx, 6.2, cz, { w: 12 });
})();

/* ======================================================================
   PISTA DE CAMINHADA (loop de terra batida a leste do ginásio — satélite)
   + ACADEMIA AO AR LIVRE no miolo do loop
   ====================================================================== */
(function walkingLoop() {
  const cls = 0xb0653a;
  addBox(null, 12.5, 0.07, 2.6, cls, 20, 0.1, -43.7, { cast: false });    // norte do loop
  addBox(null, 12.5, 0.07, 2.6, cls, 20, 0.1, -20.3, { cast: false });    // sul do loop
  addBox(null, 2.6, 0.07, 23.4, cls, 15.25, 0.1, -32, { cast: false });   // oeste
  addBox(null, 2.6, 0.07, 23.4, cls, 24.75, 0.1, -32, { cast: false });   // leste
  addRing(null, 1.2, 1.5, cls, 20, -32, 0.12, { opacity: 0.9 });          // círculo central decor.
  /* academy equipamentos (visíveis como pontinhos no loop) */
  const B = 0x2f6fdb, M = 0xd7dbe0;
  addCyl(null, 0.09, 0.09, 2.2, B, 17.5, 1.1, -34, { seg: 8 });
  addCyl(null, 0.09, 0.09, 2.2, B, 20, 1.1, -34, { seg: 8 });
  addCyl(null, 0.07, 0.07, 2.5, M, 18.75, 2.05, -34, { rz: Math.PI / 2, seg: 8 });
  addCyl(null, 0.09, 0.09, 0.9, B, 22, 0.45, -33, { seg: 8 });
  addCyl(null, 0.09, 0.09, 0.9, B, 24.4, 0.45, -33, { seg: 8 });
  addBox(null, 2.9, 0.2, 0.7, M, 23.2, 0.95, -33);
  addCyl(null, 0.09, 0.09, 1.3, B, 17.5, 0.65, -29.5, { seg: 8 });        // barra dupla
  addCyl(null, 0.09, 0.09, 1.3, B, 20, 0.65, -29.5, { seg: 8 });
  addBox(null, 2.5, 0.3, 0.7, M, 18.75, 1.3, -29.5);
  makeLabel('CONECTOR DE CAMINHADA — GINÁSIO', 20, 4.6, -18, { w: 12 });
  makeLabel('ACADEMIA AO AR LIVRE', 20, 4.2, -37.5, { w: 9.5, color: '#cfe6ff' });
})();

/* ======================================================================
   PISTA DE CAMINHADA PERIMETRAL — DÁ A VOLTA NO COMPLEXO INTEIRO
   (faixa de terra batida de ~3,6 m seguindo o contorno OSM do muro,
    com o nível de segurança mapeado para os POSTES/CÂMERAS)
   ====================================================================== */
const CMP_PTS = [                                        // contorno OSM do complexo (X,Z)
  [-41.2, -44], [8, -47], [21.8, -48], [30, -49],
  [38.9, -68.1], [29.4, 68.3], [-41.2, 69.7]
];
const ringTrack = offsetPoly(CMP_PTS, 3.4);              // linha central p/ NPC e rótulos
(function perimeterTrack() {
  const out = offsetPoly(CMP_PTS, 1.6);                  // borda externa da faixa
  const inn = offsetPoly(CMP_PTS, 5.2);                  // borda interna da faixa
  const n = out.length;
  /* Banda bilhada com quads diretos (à prova de bug — sem Shape/hole) */
  const verts = [];
  function quad(a, b, c, d) {
    verts.push(a[0], 0.11, a[1], b[0], 0.11, b[1], c[0], 0.11, c[1]);
    verts.push(a[0], 0.11, a[1], c[0], 0.11, c[1], d[0], 0.11, d[1]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ao = out[i], bo = out[j], bi = inn[j], ai = inn[i];
    const dx = bo[0] - ao[0], dz = bo[1] - ao[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const ex = dx / len * 0.35, ez = dz / len * 0.35;    // estende p/ cobrir a mitra nas quinas
    quad(
      [ao[0] - ex, ao[1] - ez], [bo[0] + ex, bo[1] + ez],
      [bi[0] + ex, bi[1] + ez], [ai[0] - ex, ai[1] - ez]
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xb0653a, side: THREE.DoubleSide }));
  m.castShadow = false;
  m.receiveShadow = true;
  scene.add(m);
  /* linha branca de faixa nos dois bordos da pista */
  function ringLine(pts) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.7) continue;
      const ln = addBox(null, len, 0.02, 0.14, 0xefeadf, (a[0] + b[0]) / 2, 0.145, (a[1] + b[1]) / 2, { cast: false });
      ln.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  ringLine(out);
  ringLine(inn);
  /* km de distância aproximada pintado no chão a oeste */
  makeLabel('PISTA DE CAMINHADA — CIRCUITO COMPLETO DO COMPLEXO', ringTrack[0][0] + 1, 4.8, (ringTrack[0][1] + ringTrack[5][1]) / 2 - 3, { w: 17, color: '#ffe0bd' });
  makeLabel('perímetro interno ≈ 300 m · ligação E1 ↔ E2', ringTrack[0][0] + 1, 3.7, (ringTrack[0][1] + ringTrack[5][1]) / 2 - 1.5, { w: 13, color: '#ffe0bd', font: 30 });
})();

/* ======================================================================
   QUIOSQUE AZUL (nordeste do loop — satélite)
   ====================================================================== */
(function kiosk() {
  addBox(null, 2.6, 2.3, 2.2, 0x2c78c9, 22.4, 1.15, -39.4);
  addBox(null, 3.2, 0.25, 2.8, 0x1d5aa8, 22.4, 2.45, -39.4);
  makeLabel('QUIOSQUE DE APOIO', 22.4, 5.2, -39.4, { w: 7.5, color: '#cfe6ff' });
  AABBs.push({ x1: 20.9, x2: 23.9, z1: -40.7, z2: -38.1 });
})();

/* ======================================================================
   PLAYGROUND (noroeste, junto ao muro norte — satélite)
   ====================================================================== */
(function playground() {
  addGround(9, 4.6, -19, -45.4, 'rubber', 0xd4557c, 0.1);  // piso emborrachado texturizado
  addBox(null, 2.2, 1.9, 2.2, 0xd0813a, -21.8, 1.05, -46);                    // torre
  addBox(null, 2.6, 0.35, 2.6, 0xa3353d, -21.8, 2.2, -46);
  addBox(null, 3.2, 0.22, 0.9, 0xf2c230, -19.4, 1.0, -45.1, { rx: -0.72 });   // escorregador
  addCyl(null, 0.07, 0.07, 2.3, 0x3a6ea5, -16.4, 1.15, -45.6, { rz: 0.42, seg: 8 }); // balanço
  addCyl(null, 0.07, 0.07, 2.3, 0x3a6ea5, -16.4, 1.15, -45.6, { rz: -0.42, seg: 8 });
  addBox(null, 0.14, 0.14, 2.4, 0x3a6ea5, -16.4, 2.3, -45.6);
  addBox(null, 0.09, 0.5, 0.3, 0x222a33, -16.9, 1.75, -45.6);
  addBox(null, 0.09, 0.5, 0.3, 0x222a33, -15.9, 1.75, -45.6);
  makeLabel('PLAYGROUND', -19, 5.6, -45.4, { w: 9 });
})();

/* ======================================================================
   CAMINHOS INTERNOS (concreto — padrão do satélite)
   ====================================================================== */
addRibbon(19.5, -48, 19.5, -34, 3.5, 0xc9c6bd, 0.08);   // portão E1 → anexo/loop
addRibbon(19.5, -34, 21, -20.5, 3.5, 0xc9c6bd, 0.08);   // até loop sul
addRibbon(19.5, -12, 21.2, -8, 3.5, 0xc9c6bd, 0.08);    // canto sudeste do anexo
addRibbon(21.2, -8, 21.2, 21, 3.5, 0xc9c6bd, 0.08);     // descendo pela leste do anexo
addRibbon(21.2, 21, 8, 21, 3.5, 0xc9c6bd, 0.08);        // entra no corredor central
addRibbon(8, 21, 8, 48, 3.5, 0xc9c6bd, 0.08);           // corredor entre campo e areia
addRibbon(8, 48, 2.5, 62, 3.5, 0xc9c6bd, 0.08);         // continuação ao portão E2
addRibbon(16, -47, -6, -46.5, 3.5, 0xc9c6bd, 0.08);     // portão → playground/skate
addRibbon(-6, -46.5, -6, -38.5, 3.5, 0xc9c6bd, 0.08);   // descida ao skate
addRibbon(-2.2, 67.6, 2.2, 67.6, 3.5, 0xc9c6bd, 0.08);  // piso do portão E2
addRibbon(-6, -38.5, -20, -38.5, 3, 0xc9c6bd, 0.08);    // "T" ao skate oeste

/* ======================================================================
   ÁREA VERDE LESTE (campo aberto — expansão)
   ====================================================================== */
makeLabel('ÁREA VERDE (EXPANSÃO FUTURA)', 20, 2.5, 28, { w: 12, color: '#e2f0d9' });

/* ======================================================================
   ÁRVORES (mata oeste/sul + pontuais internas — padrão do satélite)
   ====================================================================== */
function tree(x, z, s) {
  const g = new THREE.Group(); scene.add(g);
  addCyl(g, 0.24, 0.34, 2.4 * s, 0x6e4f2f, 0, 1.2 * s, 0, { seg: 7 });
  const f1 = new THREE.Mesh(new THREE.SphereGeometry(1.7 * s, 10, 8), matL(0x39712e));
  f1.position.y = 3.2 * s; f1.castShadow = true; g.add(f1);
  const f2 = new THREE.Mesh(new THREE.SphereGeometry(1.25 * s, 10, 8), matL(0x49893a));
  f2.position.set(0.8 * s, 2.5 * s, 0.5 * s); f2.castShadow = true; g.add(f2);
  g.position.set(x, 0, z);
}
/* mata oeste (além da Rua Flor de Maracujá) */
[-52, -70, -92, -118, -150, -186, -228].forEach(function (x) {
  tree(x + (Math.sin(x) * 3), -56 + Math.sin(x * 1.3) * 4, 1.3);
  tree(x + 6 + Math.cos(x) * 4, -68 + Math.sin(x * 0.9) * 5, 1.25);
});
/* mata sul */
[-46, -36, -26, -14, -2, 12, 26].forEach(function (x) {
  tree(x + Math.sin(x * 2.2) * 3, 92 + Math.cos(x * 1.7) * 6, 1.3);
});
tree(-46, 78, 1.2); tree(-46, 64, 1.15); tree(-38, 74, 1.25);
/* oeste entre rua e muro */
tree(-50, 28, 1.15); tree(-50, 6, 1.2); tree(-50, -20, 1.1); tree(-52, -42, 1.2);
/* norte — canteiro entre rua e muro */
tree(-8, -54, 1.1); tree(-28, -55, 1.05); tree(6, -55.5, 1); tree(28, -55, 1.15);
/* internas: oeste do ginásio / poucas */
tree(-34, -38, 0.9); tree(-35, -2, 0.85); tree(-34.5, 30, 0.9); tree(-36, 60, 0.95);
/* leste/sul do compound */
tree(24.5, 44, 0.9); tree(26, 60, 0.95); tree(-24, 64.5, 0.9);

/* ======================================================================
   POSTES DE ILUMINAÇÃO (torres simples no cercado)
   ====================================================================== */
function lamp(x, z, h) {
  addCyl(null, 0.1, 0.13, h || 7, 0x656c75, x, (h || 7) / 2, z, { seg: 8 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), matL(0xfff3c4, { emissive: 0xfff3c4 }));
  head.position.set(x, (h || 7) + 0.1, z);
  scene.add(head);
}
lamp(-34, -46, 9); lamp(-34, 10, 9); lamp(-34, 62, 9);
lamp(10, -50, 9); lamp(28, -46, 9); lamp(27.8, 64, 9);
lamp(-2, -20, 9); lamp(-2, 40, 9); lamp(-2, 67, 9);
lamp(19, -75, 7); lamp(-18, -50, 7);

/* ======================================================================
   PLACA DE IDENTIFICAÇÃO (nome + endereço completos)
   ====================================================================== */
(function sign() {
  addBox(null, 0.18, 2.6, 0.18, 0x39586e, 15.8, 1.3, -50.4);
  addBox(null, 0.18, 2.6, 0.18, 0x39586e, 22.2, 1.3, -50.4);
  addBox(null, 7, 2.2, 0.12, 0x1e4f8f, 19, 3.1, -50.4);
  makeLabel('PRAÇA DA JUVENTUDE', 19, 3.55, -50, { color: '#ffffff', bg: 'rgba(20,60,110,0.0)', w: 8.4, font: 56 });
  makeLabel('Av. Artêmio Castro Valente, 380-346', 19, 2.75, -50, { color: '#d9e8ff', bg: 'rgba(20,60,110,0.0)', w: 8.8, font: 40 });
  makeLabel('Canabrava · Salvador/BA · Aberta 24h', 19, 2.15, -50, { color: '#ffd480', bg: 'rgba(20,60,110,0.0)', w: 8.8, font: 40 });
})();

/* ======================================================================
   RÓTULOS CONTEXTUAIS
   ====================================================================== */
makeLabel('AV. ARTÊMIO CASTRO VALENTE', 40, 2.2, -95, { w: 14, color: '#f0f4fa' });
makeLabel('RUA FLOR DE MARACUJÁ', -100, 2.2, -61, { w: 15, color: '#f0f4fa' });
makeLabel('RUA FLOR DE MARACUJÁ', -215, 2.2, 12, { w: 15, color: '#f0f4fa' });
makeLabel('ESTACIONAMENTO DE RUA', -7, 3, -77, { w: 10, color: '#d7dee8' });

/* ======================================================================
   MODO SEGURANÇA
   ====================================================================== */
/* Tenda operacional (posto médico / base) */
function makeTent(x, z, color) {
  addBox(null, 6, 0.08, 5, 0x8d959e, x, 0.05, z, { cast: false });
  addCyl(null, 0.07, 0.07, 2.2, 0x6f7780, x - 2.2, 1.1, z - 1.8, { seg: 6 });
  addCyl(null, 0.07, 0.07, 2.2, 0x6f7780, x + 2.2, 1.1, z - 1.8, { seg: 6 });
  addCyl(null, 0.07, 0.07, 2.2, 0x6f7780, x - 2.2, 1.1, z + 1.8, { seg: 6 });
  addCyl(null, 0.07, 0.07, 2.2, 0x6f7780, x + 2.2, 1.1, z + 1.8, { seg: 6 });
  const top = new THREE.Mesh(new THREE.ConeGeometry(4.4, 1.5, 4), matL(color, { transparent: true, opacity: 0.92 }));
  top.position.set(x, 2.9, z);
  top.rotation.y = Math.PI / 4;
  top.castShadow = true;
  scene.add(top);
}
(function security() {
  const ORANGE = 0xf59e0b, RED = 0xef4444, BLUE = 0x38bdf8, GREEN = 0x22c55e;
  makeMarker(19, -48, ORANGE);
  makeLabel('E1 · PORTÃO NORTE — PRINCIPAL (RUA FLOR DE MARACUJÁ)', 19, 7.4, -48, { color: '#fde68a', w: 16 });
  makeMarker(0, 68.4, ORANGE);
  makeLabel('E2 · PORTÃO SUL — TRILHA DE ACESSO (PEDESTRE)', 0, 6.8, 68.4, { color: '#fde68a', w: 14 });
  /* câmeras nos vértices do cercado */
  const cams = [[-40.4, -43.2], [38.2, -66.9], [28.6, 66.6], [-40.4, 68.9]];
  const names = ['C1', 'C2', 'C3', 'C4'];
  cams.forEach(function (p, i) {
    addCyl(scene, 0.1, 0.11, 6, 0x3a4048, p[0], 3, p[1], { seg: 8 });
    addBox(scene, 0.55, 0.32, 0.4, 0x14181e, p[0] * 0.94, 5.9, p[1] * 0.94);
    makeLabel(names[i], p[0] * 0.94, 7, p[1] * 0.94, { color: '#fecaca', w: 5, font: 64 });
    const apex = new THREE.Vector3(p[0] * 0.94, 5.9, p[1] * 0.94);
    const target = new THREE.Vector3(apex.x - Math.sign(p[0]) * 20, 0.1, apex.z - Math.sign(p[1]) * 22);
    const dir = target.clone().sub(apex);
    const h = dir.length();
    dir.normalize();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(8, h, 24, 1, true),
      matL(0xfde047, { transparent: true, opacity: 0.14, side: THREE.DoubleSide })
    );
    cone.position.copy(apex).addScaledVector(dir, h / 2);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
    cone.castShadow = false;
    conesGroup.add(cone);
  });
  /* tendas: posto médico perto do E1; base operacional na ala oeste */
  makeTent(13.5, -42, 0xc0392b);
  makeLabel('PM · POSTO MÉDICO DE CAMPANHA', 13.5, 6.4, -42, { color: '#fecaca', w: 10.5 });
  makeTent(-32.5, -43, 0x2a6db0);
  makeLabel('BO · BASE OPERACIONAL E COMANDO', -32.5, 6.4, -43, { color: '#bfdbfe', w: 12 });
  /* ponto de encontro no campo society */
  makeMarker(-9.6, 36, GREEN);
  makeLabel('PE · PONTO DE ENCONTRO E TRIAGEM', -9.6, 6.4, 36, { color: '#bbf7d0', w: 11 });
  /* barricadas nos portões */
  addBox(barricadeGroup, 3.2, 1, 0.5, 0xb91c1c, 17.6, 0.5, -47.6);
  addBox(barricadeGroup, 3.2, 1, 0.5, 0xb91c1c, 20.6, 0.5, -47.9);
  addBox(barricadeGroup, 3.2, 1, 0.5, 0xb91c1c, -1.2, 0.5, 68.9);
  addBox(barricadeGroup, 3.2, 1, 0.5, 0xb91c1c, 1.2, 0.5, 68.7);
  secGroup.visible = false;
  conesGroup.visible = false;
  barricadeGroup.visible = false;
})();

/* Rotas de evacuação */
(function evacuation() {
  function arrow(from, to, color) {
    const pts = [new THREE.Vector3(from[0], 0.3, from[1]), new THREE.Vector3(to[0], 0.3, to[1])];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: color }));
    evacGroup.add(line);
    const dir = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.4, 12), matL(color, { emissive: color }));
    cone.position.set(to[0], 0.6, to[1]);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    evacGroup.add(cone);
  }
  arrow([-15.5, -36], [16, -46], 0x22c55e);        // skate → E1
  arrow([-9.6, 45], [0.5, 66.5], 0x22c55e);        // campo → E2
  arrow([17.6, 42], [1, 64], 0x22c55e);            // quadra areia → E2 (corredor)
  arrow([20, -34], [19, -46.5], 0x22c55e);         // loop/academia → E1
  arrow([-9.6, 15], [16, -44], 0xfde047);          // campo norte → convergência E1
  arrow([-33, -42], [16, -46], 0xfde047);          // base oeste → E1
  evacGroup.visible = false;
})();

/* ======================================================================
   SIMULAÇÕES PÚBLICO-ALVOS
   1) PESSOAS: multidão caminhando pelos circuitos reais
   2) INCÊNDIO: foco clicável (chama, fumaça, alarme, viatura dos bombeiros)
   3) EVACUAÇÃO: cronômetro, rota por grafo e % de público fora da praça
   ====================================================================== */
const simBar = document.getElementById('simStatus');
const NPC_COLORS = [0xe25822, 0x2d5aa8, 0x3a9b57, 0xd9a03c, 0x8e4d9e, 0xb84b61, 0x4aa3a2, 0x8a8f98, 0x6a4f3d, 0x1f6f4f];
let npcOn = false, fireOn = false, simEvac = false, simDone = false;
let simClock = 0, simTotal = 0, simEvacuated = 0, fireTruckT = -1;
let evacSource = null;                                   // 'fire' | 'user' (quem iniciou)
const npcs = [];
const npcGroup = new THREE.Group();
npcGroup.visible = false;
scene.add(npcGroup);

/* Grafo de circulação pública — os pontos seguem caminhos/pistas reais */
const NODES = [];
const ADJ = [];
function addNode(x, z) { NODES.push([x, z]); ADJ.push([]); return NODES.length - 1; }
function linkNodes(a, b) { ADJ[a].push(b); ADJ[b].push(a); }
const n_g1 = addNode(19, -46.5);          // 0 gate E1
const n_g1w = addNode(15.5, -46.2);       // 1 frente playground
const n_play = addNode(-6, -44.6);        // 2 playground
const n_skw = addNode(-20, -38.5);        // 3 skate oeste
const n_skate = addNode(-6, -38.5);       // 4 skate leste
const n_rA = addNode(ringTrack[0][0], ringTrack[0][1]);   // 5 pista oeste-norte
const n_rB = addNode(ringTrack[1][0], ringTrack[1][1]);   // 6 pista norte
const n_rC = addNode(ringTrack[2][0], ringTrack[2][1]);   // 7 pista E1
const n_rD = addNode(ringTrack[3][0], ringTrack[3][1]);   // 8 pista nordeste
const n_rE = addNode(ringTrack[4][0], ringTrack[4][1]);   // 9 pista leste
const n_rF = addNode(ringTrack[5][0], ringTrack[5][1]);   // 10 pista sudeste
const n_rG = addNode(ringTrack[6][0], ringTrack[6][1]);   // 11 pista sudoeste
const n_annex = addNode(19.5, -33);       // 12 corredor do anexo
const n_se = addNode(21.2, -8);           // 13 leste do anexo
const n_corrT = addNode(21.2, 20.5);      // 14 topo do corredor
const n_corrW = addNode(8, 20.5);         // 15 corredor oeste
const n_corrM = addNode(8, 44);           // 16 meio do corredor (entre campos)
const n_g2 = addNode(0, 66);              // 17 gate E2
const n_loopN = addNode(20, -43.7);       // 18 loop norte
const n_loopE = addNode(24.7, -32);       // 19 loop leste
const n_loopS = addNode(20, -20.5);       // 20 loop sul
const n_loopW = addNode(15.3, -32);       // 21 loop oeste
const n_yard = addNode(-14, 9);           // 22 pátio sul do ginásio (porta)
const n_door = addNode(-14.4, 8.2);       // 23 anteporta do ginásio
const n_gymIn = addNode(-14.4, -5);       // 24 DENTRO do ginásio
const n_field = addNode(-9.6, 36);        // 25 centro do campo (PE)
linkNodes(n_g1, n_g1w); linkNodes(n_g1w, n_play); linkNodes(n_play, n_skw); linkNodes(n_skw, n_skate);
linkNodes(n_g1, n_rC); linkNodes(n_g1w, n_rB); linkNodes(n_play, n_rB);
linkNodes(n_rA, n_rB); linkNodes(n_rB, n_rC); linkNodes(n_rC, n_rD); linkNodes(n_rD, n_rE);
linkNodes(n_rE, n_rF); linkNodes(n_rF, n_rG); linkNodes(n_rG, n_rA);
linkNodes(n_g1, n_annex); linkNodes(n_annex, n_se); linkNodes(n_se, n_corrT); linkNodes(n_corrT, n_corrW);
linkNodes(n_corrW, n_corrM); linkNodes(n_corrM, n_g2); linkNodes(n_g2, n_rF); linkNodes(n_rG, n_g2);
linkNodes(n_loopN, n_loopE); linkNodes(n_loopE, n_loopS); linkNodes(n_loopS, n_loopW); linkNodes(n_loopW, n_loopN);
linkNodes(n_annex, n_loopS); linkNodes(n_loopN, n_rC); linkNodes(n_loopW, n_annex);
linkNodes(n_corrW, n_yard); linkNodes(n_yard, n_door); linkNodes(n_door, n_gymIn);
linkNodes(n_yard, n_field); linkNodes(n_field, n_corrM); linkNodes(n_field, n_corrW);
linkNodes(n_skw, n_rA); linkNodes(n_skw, n_rB); linkNodes(n_skate, n_play);
const NPC_PORTS = [n_g1, n_g2, n_rD, n_rF, n_loopE, n_se, n_yard, n_play, n_skw];

function nearestNode(x, z) {
  let best = 0, bd = 1e9;
  NODES.forEach(function (p, i) {
    const d = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
function bfsPath(from, to) {
  const prev = {};
  const vis = {};
  vis[from] = true;
  const q = [from];
  let found = false;
  while (q.length) {
    const u = q.shift();
    if (u === to) { found = true; break; }
    ADJ[u].forEach(function (v) { if (!vis[v]) { vis[v] = true; prev[v] = u; q.push(v); } });
  }
  if (!found) return null;
  const path = [to];
  let c = to;
  while (c !== from) { c = prev[c]; path.unshift(c); }
  return path;
}
function makeNpcMesh(i) {
  const g = new THREE.Group();
  const shirt = NPC_COLORS[i % NPC_COLORS.length];
  const skin = [0xd9a066, 0x9c6b3f, 0xb06e42][i % 3];
  function part(w, h, d, color, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matL(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  }
  const torso = part(0.38, 0.5, 0.22, shirt, 0, 1.02, 0);
  part(0.11, 0.46, 0.13, shirt, -0.24, 1.0, 0);
  part(0.11, 0.46, 0.13, shirt, 0.24, 1.0, 0);
  part(0.13, 0.44, 0.16, 0x2b3a4d, -0.09, 0.31, 0);
  part(0.13, 0.44, 0.16, 0x2b3a4d, 0.09, 0.31, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), matL(skin));
  head.position.set(0, 1.46, 0);
  head.castShadow = true;
  g.add(head);
  g.userData = { torso: torso };
  return g;
}
function spawnCrowd() {
  npcs.length = 0;
  npcGroup.clear();
  for (let i = 0; i < 26; i++) {
    const start = NODES[NPC_PORTS[i % NPC_PORTS.length]];
    const mesh = makeNpcMesh(i);
    npcGroup.add(mesh);
    npcs.push({
      g: mesh, x: start[0], z: start[1], node: NPC_PORTS[i % NPC_PORTS.length],
      target: null, route: null, prev: null, speed: 1.1 + Math.random() * 0.8,
      phase: Math.random() * 6, done: false, count: false, state: 'idle'
    });
    const neigh = ADJ[NPC_PORTS[i % NPC_PORTS.length]];
    npcs[i].target = neigh[Math.floor(Math.random() * neigh.length)];
    npcs[i].g.userData.baseColor = NPC_COLORS[i % NPC_COLORS.length];
  }
  simTotal = npcs.length;
}
function npcAdvance(n) {
  if (n.state === 'evac') {
    /* chegou a um portão → marcado como evacuado */
    if (n.node === 0 || n.node === 17) {
      n.done = true;
      if (!n.count) { n.count = true; simEvacuated++; }
      n.x = NODES[n.node][0] + (Math.random() * 3 - 1.5);
      n.z = NODES[n.node][1] + (n.node === 17 ? 3.8 : -2.8);   // do lado de fora do muro
      n.g.userData.torso.material.color.setHex(0x22c55e);      // verde = fora de risco
      n.target = null;
      return;
    }
    /* segue a rota BFS; se esvaziou, recalcula */
    if (!n.route || !n.route.length) {
      const p1 = bfsPath(n.node, 0), p2 = bfsPath(n.node, 17);
      const l1 = p1 ? p1.length : 99, l2 = p2 ? p2.length : 99;
      n.route = (l2 < l1 ? p2 : p1).slice(1);
    }
    n.prev = n.node;
    n.target = n.route.shift();
    return;
  }
  /* passeio livre: vizinho aleatório de onde estiver */
  const neigh = ADJ[n.node];
  if (!neigh.length) return;
  let pick = neigh[Math.floor(Math.random() * neigh.length)];
  if (neigh.length > 1 && pick === n.prev) pick = neigh[(neigh.indexOf(pick) + 1) % neigh.length];
  n.prev = n.node;
  n.target = pick;
}
function crowdStartEvac(evacSrc) {
  npcs.forEach(function (n) {
    if (n.done) return;
    n.state = 'evac';
    const p1 = bfsPath(n.node, 0), p2 = bfsPath(n.node, 17);
    const l1 = p1 ? p1.length : 99, l2 = p2 ? p2.length : 99;
    n.route = (l2 < l1 ? p2 : p1).slice(1);
  });
  simClock = 0; simDone = false; simEvacuated = 0;
  simEvac = true;
  if (evacSrc) evacSource = evacSrc;
  else if (!evacSource) evacSource = 'user';
  simBar.classList.add('show');
}
function toggleCrowd(on) {
  npcOn = on;
  npcGroup.visible = on;
  btnCrowd.classList.toggle('on', on);
  if (on && !npcs.length) spawnCrowd();
  if (!on) { simEvac = false; simDone = false; simBar.classList.remove('show'); clearFire(); btnFire.classList.remove('on'); fireOn = false; }
}
/* ------------------------------ INCÊNDIO ------------------------------- */
let fireGroup = null, smokeSprites = [], fireTruck = null;
const ringPulse = [];
function spawnFire(x, z) {
  x = Math.max(-39, Math.min(37, x));
  z = Math.max(-67, Math.min(67, z));
  clearFire();
  fireGroup = new THREE.Group();
  fireGroup.position.set(x, 0, z);
  scene.add(fireGroup);
  /* solo chamuscado + risco vermelho pulsante */
  addBox(fireGroup, 3.4, 0.02, 3.4, 0x241a12, 0, 0.14, 0, { cast: false });
  const r1 = addRing(fireGroup, 2.2, 2.7, 0xe23b3b, 0, 0.18, 0.2, { opacity: 0.95 });
  const r2 = addRing(fireGroup, 3.4, 3.9, 0xff9f4a, 0, 0.17, 0.14, { opacity: 0.7 });
  r1.userData.alarmPulse = true;
  r2.userData.alarmPulse = true;
  ringPulse.push(r1, r2);
  /* chamas (cones tremulantes) */
  addCyl(fireGroup, 0.8, 1.15, 2.4, 0xd43b1c, 0, 1.3, 0, { seg: 10 }).userData.flame = true;
  addCyl(fireGroup, 0.55, 0.8, 1.9, 0xff7a1a, 0.7, 1.05, 0.4, { seg: 9 }).userData.flame = true;
  addCyl(fireGroup, 0.45, 0.65, 1.5, 0xffc04d, -0.6, 0.85, -0.35, { seg: 8 }).userData.flame = true;
  addCyl(fireGroup, 0.12, 0.12, 1.8, 0x3a2a1a, 1.35, 0.7, 0.5, { seg: 6, rz: 0.12 });
  fireGroup.userData.flames = [];
  fireGroup.children.forEach(function (c) { if (c.userData.flame) fireGroup.userData.flames.push(c); });
  /* fumaça (sprites com subida contínua) */
  smokeSprites = [];
  const sc = document.createElement('canvas');
  sc.width = 64; sc.height = 64;
  const sctx = sc.getContext('2d');
  const grad = sctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(40,40,40,0.85)');
  grad.addColorStop(0.6, 'rgba(70,70,70,0.4)');
  grad.addColorStop(1, 'rgba(90,90,90,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 64, 64);
  const smokeTex = new THREE.CanvasTexture(sc);
  for (let i = 0; i < 16; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0.7, depthWrite: false }));
    sp.position.set((Math.random() - 0.5) * 2, 1.5 + Math.random() * 5, (Math.random() - 0.5) * 2);
    sp.userData = { age: Math.random() * 2.2, base: sp.position.clone() };
    fireGroup.add(sp);
    smokeSprites.push(sp);
  }
  /* rótulo do foco de incêndio */
  makeLabel('INCÊNDIO SIMULADO — FOCO ATIVO', 0, 6.4, 0, { w: 9, color: '#fecaca', parent: fireGroup });
  /* multidão foge do fogo */
  if (npcOn) {
    simEvac = false; simDone = false;
    crowdStartEvac('fire');
  }
  fireTruckT = 3;                                      // viatura chega após 3 s
  fireOn = true;
  simBar.classList.add('show');
}
function buildFireTruck() {
  fireTruck = new THREE.Group();
  addBox(fireTruck, 4.6, 1.7, 2.1, 0xd42b2b, 0, 1.15, 0);
  addBox(fireTruck, 0.18, 0.5, 2.2, 0xffffff, 0.5, 1.0, 0);
  addBox(fireTruck, 1.5, 1.3, 2.0, 0xc42525, -2.6, 0.95, 0);
  addBox(fireTruck, 1.35, 0.55, 1.8, 0x27313d, -2.6, 1.75, 0, { transparent: true, opacity: 0.9 });
  addBox(fireTruck, 0.35, 0.35, 1.0, 0xffd84d, -2.5, 2.28, 0);   // giroflex amarelo
  addBox(fireTruck, 0.14, 0.5, 0.5, 0xd42b2b, 1.9, 0.75, 1.12);
  addBox(fireTruck, 0.14, 0.5, 0.5, 0xd42b2b, 1.9, 0.75, -1.12);
  addBox(fireTruck, 0.14, 0.5, 0.5, 0xd42b2b, -2.0, 0.75, 1.12);
  addBox(fireTruck, 0.14, 0.5, 0.5, 0xd42b2b, -2.0, 0.75, -1.12);
  scene.add(fireTruck);
}
function clearFire() {
  if (fireGroup) { scene.remove(fireGroup); fireGroup = null; }
  smokeSprites = [];
  ringPulse.length = 0;
  if (fireTruck) { scene.remove(fireTruck); fireTruck = null; }
  fireTruckT = -1;
}
function toggleFire(on) {
  fireOn = on;
  btnFire.classList.toggle('on', on);
  if (on) spawnFire(-10.2, 4.2);                       // foco padrão: pátio do ginásio
  else {
    clearFire();
    if (!simEvac) simBar.classList.remove('show');
    if (npcOn) {                                       // só cancela se a evacuação era do fogo
      if (evacSource === 'fire') {
        npcs.forEach(function (n) { if (!n.done) { n.state = 'idle'; n.route = null; simEvac = false; n.g.userData.torso.material.color.setHex(n.g.userData.baseColor || 0xffffff); } });
        evacSource = null;
      }
    }
  }
}
/* registrar cor base para restaurar */
function setNpcBaseColors() {
  for (let i = 0; i < 26; i++) { if (npcs[i]) npcs[i].g.userData.baseColor = NPC_COLORS[i % NPC_COLORS.length]; }
}
const firePlane = new THREE.Mesh(
  new THREE.PlaneGeometry(700, 560),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
);
firePlane.rotation.x = -Math.PI / 2;
firePlane.position.set(-60, 0.02, -40);
scene.add(firePlane);

/* --------------------------- Avatar ------------------------------------ */
(function buildAvatar() {
  avatar = new THREE.Group();
  const skin = 0xd9a066, shirt = 0x1e63c8, pants = 0x2b3a4d, shoe = 0x181c22;
  addBox(avatar, 0.5, 0.62, 0.3, shirt, 0, 1.12, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), matL(skin));
  head.position.set(0, 1.62, 0); head.castShadow = true; avatar.add(head);
  addBox(avatar, 0.26, 0.09, 0.3, 0x111820, 0, 1.78, -0.02);
  avatarParts.armL = addBox(avatar, 0.13, 0.55, 0.15, shirt, -0.33, 1.12, 0);
  avatarParts.armR = addBox(avatar, 0.13, 0.55, 0.15, shirt, 0.33, 1.12, 0);
  function leg(sx) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.14, 0.82, 0);
    addBox(pivot, 0.17, 0.62, 0.2, pants, 0, -0.31, 0);
    addBox(pivot, 0.18, 0.14, 0.32, shoe, 0, -0.68, -0.05);
    avatar.add(pivot);
    return pivot;
  }
  avatarParts.legL = leg(-1);
  avatarParts.legR = leg(1);
  avatar.position.set(avatarState.x, 0, avatarState.z);
  scene.add(avatar);
})();

/* ================================ UI =================================== */
const btnOrb = document.getElementById('btnOrbital');
const btnWalk = document.getElementById('btnPasseio');
const btnSec = document.getElementById('btnSeguranca');
const btnLbl = document.getElementById('btnRotulos');
const btnRoof = document.getElementById('btnTelhado');
const btnEva = document.getElementById('btnEvacuacao');
const btnCrowd = document.getElementById('btnPessoas');
const btnFire = document.getElementById('btnFogo');
const btnSimE = document.getElementById('btnSimEvac');
const btnFP = document.getElementById('btnVisao');
const hint = document.getElementById('hint');
const badge = document.getElementById('modeBadge');

function updHint() {
  if (fireOn && mode === 'orbital') {
    hint.innerHTML = '<b>Incêndio ativo</b> · clique no chão para mover o foco do incêndio · demais botões seguem normais';
    return;
  }
  if (mode === 'orbital') {
    hint.innerHTML = IS_TOUCH
      ? '<b>Arraste</b> para girar a maquete · <b>Pinça</b> para zoom · <b>P</b> pessoas · <b>F</b> incêndio · <b>X</b> evacuar'
      : 'Arraste para girar a maquete · <b>Scroll</b> para zoom · <b>S</b> segurança · <b>P</b> pessoas · <b>F</b> incêndio · <b>X</b> evacuar';
  } else if (!locked) {
    hint.innerHTML = IS_TOUCH
      ? '<b>Joystick</b> (lado esquerdo) para andar · <b>Arraste</b> o resto da tela para olhar 360°'
      : '<b>Clique na tela</b> para assumir o controle do avatar';
  } else {
    hint.innerHTML = '<b>W A S D</b> andar · <b>Shift</b> correr · <b>Mouse</b> olhar · <b>V</b> 1ª/3ª pessoa · <b>Esc</b> soltar';
  }
}
function setMode(m) {
  mode = m;
  btnOrb.classList.toggle('on', m === 'orbital');
  btnWalk.classList.toggle('on', m === 'passeio');
  document.body.classList.toggle('walk', m === 'passeio');
  document.body.classList.toggle('fp', m === 'passeio' && firstPerson);
  if (m === 'orbital') {
    if (document.pointerLockElement) document.exitPointerLock();
    cameraUp();
    badge.textContent = 'Vista Geral';
  } else {
    /* pointer lock não existe em celular/tablet — no touch o olhar é por arraste */
    if (!IS_TOUCH) renderer.domElement.requestPointerLock();
    badge.textContent = firstPerson ? 'Passeio — 1ª Pessoa' : 'Passeio — Avatar';
  }
  badge.classList.toggle('sec', secOn);
  updHint();
}
function toggleFP() {
  firstPerson = !firstPerson;
  document.body.classList.toggle('fp', firstPerson);
  badge.textContent = 'Passeio — ' + (firstPerson ? '1ª Pessoa' : 'Avatar');
  updHint();
}
btnOrb.onclick = function () { setMode('orbital'); };
btnWalk.onclick = function () { setMode('passeio'); };
btnFP.onclick = toggleFP;

function applySec(v) {
  secOn = v;
  btnSec.classList.toggle('on', v);
  document.body.classList.toggle('sec', v);
  secGroup.visible = v;
  conesGroup.visible = v;
  barricadeGroup.visible = v;
  badge.classList.toggle('sec', v);
}
function applyLabels(v) {
  labelsOn = v;
  btnLbl.classList.toggle('on', v);
  labelsGroup.visible = v;
}
function applyRoof(translucent) {
  roofOpaque = !translucent;
  btnRoof.classList.toggle('on', translucent);
  gymRoofMats.forEach(function (m) { m.opacity = translucent ? 0.08 : 1; });
}
function applyEvac(v) {
  evacOn = v;
  btnEva.classList.toggle('on', v);
  evacGroup.visible = v;
}

btnSec.onclick = function () { applySec(!secOn); };
btnLbl.onclick = function () { applyLabels(!labelsOn); };
btnRoof.onclick = function () { applyRoof(roofOpaque); };
btnEva.onclick = function () { applyEvac(!evacOn); };
btnCrowd.onclick = function () { toggleCrowd(!npcOn); };
btnFire.onclick = function () { toggleFire(!fireOn); };
btnSimE.onclick = function () {
  if (!npcOn) toggleCrowd(true);
  crowdStartEvac('user');
};

/* Teclado */
addEventListener('keydown', function (e) {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
  if (e.code === 'KeyV' && mode === 'passeio') {
    toggleFP();
  }
  if (e.code === 'KeyS' && mode === 'orbital') applySec(!secOn);
  if (e.code === 'KeyL' && mode === 'orbital') applyLabels(!labelsOn);
  if (e.code === 'KeyT') applyRoof(!btnRoof.classList.contains('on'));
  if (e.code === 'KeyE' && mode === 'orbital') applyEvac(!evacOn);
  if (e.code === 'KeyP' && mode === 'orbital') toggleCrowd(!npcOn);
  if (e.code === 'KeyF' && mode === 'orbital') toggleFire(!fireOn);
  if (e.code === 'KeyX' && mode === 'orbital') {
    if (!npcOn) toggleCrowd(true);
    crowdStartEvac('user');
  }
});
addEventListener('keyup', function (e) { keys[e.code] = false; });

/* Pointer lock + mouse */
document.addEventListener('pointerlockchange', function () {
  locked = document.pointerLockElement === renderer.domElement;
  updHint();
});
addEventListener('mousemove', function (e) {
  if (drag && mode === 'orbital') {
    orbit.theta -= (e.clientX - lastMX) * 0.0052;
    orbit.phi = Math.max(0.12, Math.min(1.44, orbit.phi - (e.clientY - lastMY) * 0.0052));
    lastMX = e.clientX; lastMY = e.clientY;
    cameraUp();
  } else if (locked && mode === 'passeio') {
    yaw -= e.movementX * 0.0026;
    pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * 0.0022));
  }
});
renderer.domElement.addEventListener('mousedown', function (e) {
  if (e.button === 0) {
    if (mode === 'orbital') { drag = true; lastMX = e.clientX; lastMY = e.clientY; dragDist = 0; }
    else if (!locked) renderer.domElement.requestPointerLock();
  }
});
addEventListener('mousemove', function (e) { if (drag) dragDist += Math.abs(e.movementX) + Math.abs(e.movementY); });
addEventListener('mouseup', function (e) {
  if (drag && dragDist < 6 && fireOn && mode === 'orbital' && e.button === 0) {
    /* clique curto com incêndio ativo → mover o foco de incêndio para o chão clicado */
    pickFireFloor(e.clientX, e.clientY);
  }
  drag = false;
});
function pickFireFloor(px, py) {
  const ndc = new THREE.Vector2(
    (px / window.innerWidth) * 2 - 1,
    -(py / window.innerHeight) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(firePlane);
  if (hit.length) spawnFire(hit[0].point.x + 60, hit[0].point.z + 40);
}
addEventListener('wheel', function (e) {
  if (mode !== 'orbital') return;
  orbit.radius = Math.max(30, Math.min(420, orbit.radius * (e.deltaY > 0 ? 1.09 : 0.92)));
  cameraUp();
}, { passive: true });

/* ------------------------ Touch (celular / tablet) ---------------------- */
if (IS_TOUCH) {
  document.body.classList.add('touch');
  const kbdHelp = document.getElementById('kbdHelp');
  if (kbdHelp) {
    kbdHelp.innerHTML = '<b>Arrastar</b> girar · <b>Pinça</b> zoom<br><b>Avatar</b>: joystick à esquerda · arrastar = olhar';
  }

  const joy = document.getElementById('joy');
  const joyKnob = document.getElementById('joyKnob');
  const JOY_R = 52;                                   /* raio do joystick, px */
  let joyCx = 0, joyCy = 0;

  function joyShow(x, y) {
    joyCx = x; joyCy = y;
    joy.style.left = (x - 65) + 'px';
    joy.style.top = (y - 65) + 'px';
    joy.classList.add('show');
    joyKnob.style.transform = 'translate(0px,0px)';
    joyVec.x = 0; joyVec.y = 0;
  }
  function joyHide() {
    joy.classList.remove('show');
    joyVec.x = 0; joyVec.y = 0;
  }
  function joyMove(x, y) {
    let dx = x - joyCx, dy = y - joyCy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_R) { dx = dx / d * JOY_R; dy = dy / d * JOY_R; }
    joyKnob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    joyVec.x = dx / JOY_R; joyVec.y = dy / JOY_R;
  }
  function orbitTouchIds() {
    const arr = [];
    for (const id in touchMap) if (touchMap[id].type === 'orbit') arr.push(id);
    return arr;
  }
  function refreshLast(id, x, y) {
    const st = touchMap[id];
    if (st) { st.lastX = x; st.lastY = y; }
  }

  renderer.domElement.addEventListener('touchstart', function (e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const walkZone = mode === 'passeio' && t.clientX < innerWidth * 0.5 && t.clientY > innerHeight * 0.45;
      if (walkZone) {
        touchMap[t.identifier] = { type: 'joy' };
        joyShow(t.clientX, t.clientY);
      } else {
        touchMap[t.identifier] = {
          type: mode === 'orbital' ? 'orbit' : 'look',
          lastX: t.clientX, lastY: t.clientY, dist: 0
        };
      }
    }
    /* 2 dedos em modo orbital → pinça de zoom */
    if (mode === 'orbital') {
      const ids = orbitTouchIds();
      if (ids.length === 2) {
        const a = touchMap[ids[0]], b = touchMap[ids[1]];
        pinch = { active: true, startDist: Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY), startRadius: orbit.radius };
        pinchHappened = true;
      }
    }
  }, { passive: false });

  renderer.domElement.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (pinch.active) {
      const pts = [];
      for (let i = 0; i < e.touches.length; i++) {
        const st = touchMap[e.touches[i].identifier];
        if (st && st.type === 'orbit') {
          st.lastX = e.touches[i].clientX; st.lastY = e.touches[i].clientY;
          pts.push(st);
        }
      }
      if (pts.length >= 2) {
        const d = Math.hypot(pts[0].lastX - pts[1].lastX, pts[0].lastY - pts[1].lastY);
        if (d > 10) {
          orbit.radius = Math.max(30, Math.min(420, pinch.startRadius * pinch.startDist / d));
          cameraUp();
        }
      }
      return;
    }
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const st = touchMap[t.identifier];
      if (!st) continue;
      const dx = t.clientX - st.lastX, dy = t.clientY - st.lastY;
      st.dist += Math.abs(dx) + Math.abs(dy);
      if (st.type === 'orbit') {
        orbit.theta -= dx * 0.0052;
        orbit.phi = Math.max(0.12, Math.min(1.44, orbit.phi - dy * 0.0052));
        cameraUp();
      } else if (st.type === 'look') {
        yaw -= dx * 0.005;
        pitch = Math.max(-1.2, Math.min(1.2, pitch - dy * 0.0036));
      } else if (st.type === 'joy') {
        joyMove(t.clientX, t.clientY);
      }
      st.lastX = t.clientX; st.lastY = t.clientY;
    }
  }, { passive: false });

  function touchEndHandler(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const st = touchMap[t.identifier];
      if (st) {
        if (st.type === 'joy') joyHide();
        else if (st.type === 'orbit' && mode === 'orbital' && st.dist < 14 &&
                 fireOn && !pinch.active && !pinchHappened && orbitTouchIds().length === 1) {
          pickFireFloor(t.clientX, t.clientY);
        }
        delete touchMap[t.identifier];
      }
    }
    if (pinch.active && orbitTouchIds().length < 2) {
      pinch.active = false;
      /* evita salto de rotação ao sair da pinça */
      for (let i = 0; i < e.touches.length; i++) {
        refreshLast(e.touches[i].identifier, e.touches[i].clientX, e.touches[i].clientY);
      }
    }
    if (orbitTouchIds().length === 0) pinchHappened = false;
  }
  renderer.domElement.addEventListener('touchend', touchEndHandler, { passive: false });
  renderer.domElement.addEventListener('touchcancel', touchEndHandler, { passive: false });
}

/* Câmera orbital */
function cameraUp() {
  camera.rotation.set(0, 0, 0);
  camera.position.set(
    orbit.target.x + orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta),
    orbit.target.y + orbit.radius * Math.cos(orbit.phi),
    orbit.target.z + orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta)
  );
  camera.lookAt(orbit.target);
}
cameraUp();

/* --------------------------- Movimento do avatar ------------------------ */
function collide(nx, nz) {
  nx = Math.max(BOUND.x1, Math.min(BOUND.x2, nx));
  nz = Math.max(BOUND.z1, Math.min(BOUND.z2, nz));
  const R = 0.35;
  for (let i = 0; i < AABBs.length; i++) {
    const b = AABBs[i];
    if (nx > b.x1 - R && nx < b.x2 + R && nz > b.z1 - R && nz < b.z2 + R) {
      const dx1 = nx - (b.x1 - R), dx2 = (b.x2 + R) - nx;
      const dz1 = nz - (b.z1 - R), dz2 = (b.z2 + R) - nz;
      const m = Math.min(dx1, dx2, dz1, dz2);
      if (m === dx1) nx = b.x1 - R;
      else if (m === dx2) nx = b.x2 + R;
      else if (m === dz1) nz = b.z1 - R;
      else nz = b.z2 + R;
    }
  }
  return { x: nx, z: nz };
}

function updateWalk(dt) {
  const jmag = Math.min(1, Math.hypot(joyVec.x, joyVec.y));
  const run = keys['ShiftLeft'] || keys['ShiftRight'] || jmag > 0.85;
  const sp = (run ? RUN_SPEED : WALK_SPEED) * dt;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = -fz, rz = fx;
  let mx = 0, mz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) { mx += fx; mz += fz; }
  if (keys['KeyS'] || keys['ArrowDown']) { mx -= fx; mz -= fz; }
  if (keys['KeyA'] || keys['ArrowLeft']) { mx -= rx; mz -= rz; }
  if (keys['KeyD'] || keys['ArrowRight']) { mx += rx; mz += rz; }
  /* joystick virtual (celular): y = frente/trás, x = esquerda/direita, analógico */
  if (jmag > 0.08) {
    const jx = joyVec.x, jy = -joyVec.y;
    mx += fx * jy + rx * jx;
    mz += fz * jy + rz * jx;
  }
  const mag = Math.hypot(mx, mz);
  const moving = mag > 0.001;
  if (moving) {
    mx = mx / mag * sp; mz = mz / mag * sp;
    const res = collide(avatarState.x + mx, avatarState.z + mz);
    avatarState.x = res.x; avatarState.z = res.z;
    avatar.rotation.y = yaw;
    walkT += dt * (run ? 11 : 7);
  }
  avatar.position.set(avatarState.x, 0, avatarState.z);
  const s = moving ? Math.sin(walkT) : 0;
  avatarParts.legL.rotation.x = s * 0.65;
  avatarParts.legR.rotation.x = -s * 0.65;
  avatarParts.armL.rotation.x = -s * 0.5;
  avatarParts.armR.rotation.x = s * 0.5;

  if (firstPerson) {
    camera.rotation.order = 'YXZ';
    camera.position.set(avatarState.x, 1.58, avatarState.z);
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    camera.rotation.z = 0;
  } else {
    const dist = 6.5;
    camera.rotation.set(0, 0, 0);
    camera.position.set(avatarState.x + Math.sin(yaw) * dist, 3.1, avatarState.z + Math.cos(yaw) * dist);
    camera.lookAt(avatarState.x, 1.35, avatarState.z);
  }
}

/* ------------------------------ Loop render ----------------------------- */
let prevT = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now - prevT) / 1000);
  prevT = now;

  if (mode === 'passeio') updateWalk(dt);

  /* --------------------------- Simulações ------------------------------- */
  if (npcOn) {
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (n.target === null) { n.g.position.y = 0; continue; }   // evacuado, parado fora
      const T = NODES[n.target];
      const dx = T[0] - n.x, dz = T[1] - n.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.55) {                                    // chegou → decide próximo
        n.node = n.target;
        n.x = T[0]; n.z = T[1];
        npcAdvance(n);
      } else {
        const spv = n.speed * dt * (n.state === 'evac' ? 1.35 : 1);
        n.x += dx / d * spv;
        n.z += dz / d * spv;
        n.g.userData.torso.parent.rotation.y = Math.atan2(-dx, -dz);
      }
      n.phase += dt * (n.state === 'evac' ? 11 : 8);
      n.g.position.set(n.x, Math.abs(Math.sin(n.phase)) * 0.045, n.z);
    }
    if (simEvac || simDone) {
      if (!simDone) {
        simClock += dt;
        if (simEvacuated >= simTotal) simDone = true;
      }
      simBar.innerHTML = simDone
        ? '✅ Evacuação concluída — <b>' + simTotal + '/' + simTotal + '</b> pessoas fora da praça em <b>' + simClock.toFixed(1) + ' s</b>'
        : '🚨 <b>Evacuação em andamento</b> — fora de risco: <b>' + simEvacuated + '/' + simTotal + '</b> · tempo: <b>' + simClock.toFixed(1) + ' s</b> · cor verde = fora de risco';
    } else if (fireOn) {
      simBar.innerHTML = '🔥 <b>Incêndio simulado</b> — clique no chão para mover o foco · viatura a caminho · <b>F</b> desativa';
    }
  } else if (fireOn) {
    simBar.innerHTML = '🔥 <b>Incêndio simulado</b> — ative <b>Pessoas</b> para ver a multidão reagir e evacuar';
  }

  /* incêndio: chamas tremulando + fumaça subindo + alarme pulsando */
  if (fireGroup && fireOn) {
    for (let i = 0; i < fireGroup.userData.flames.length; i++) {
      const f = fireGroup.userData.flames[i];
      const base = f.geometry.parameters.height;
      f.scale.y = 1 + Math.sin(now * 0.012 + i * 2.1) * 0.18 + Math.random() * 0.05;
      f.scale.x = 1 + Math.sin(now * 0.01 + i) * 0.07;
      f.material.emissive.setHex(i % 2 ? 0xff6a1a : 0xd43b1c);
    }
    for (let i = 0; i < smokeSprites.length; i++) {
      const s = smokeSprites[i];
      s.userData.age += dt;
      if (s.userData.age > 2.4) {
        s.userData.age = 0;
        s.position.set((Math.random() - 0.5) * 2, 1.4, (Math.random() - 0.5) * 2);
      }
      s.position.y += dt * 1.7;
      const gr = 1 + s.userData.age * 1.6;
      s.scale.set(gr, gr, 1);
      s.material.opacity = Math.max(0, 0.65 - s.userData.age * 0.27);
    }
    for (let i = 0; i < fireGroup.children.length; i++) {
      const c = fireGroup.children[i];
      if (c.userData.alarmPulse) c.material.opacity = 0.55 + Math.sin(now * 0.006) * 0.4;
    }
    if (fireTruckT >= 0) {
      fireTruckT -= dt;
      if (fireTruckT <= 0 && !fireTruck) {
        buildFireTruck();
      }
    }
    if (fireTruck) {
      /* rota da viatura: Av. Artêmio Castro Valente → glamour do portão E1 */
      fireTruck.userData.t = (fireTruck.userData.t || 0) + dt * 0.22;
      const t = Math.min(1, fireTruck.userData.t);
      const path = [[-40, -95], [0, -93], [16.5, -52], [17.5, -51.5]];
      let px, pz, ang = 0;
      if (t < 0.55) {
        const k = t / 0.55;
        px = path[0][0] + (path[1][0] - path[0][0]) * k;
        pz = path[0][1] + (path[1][1] - path[0][1]) * k;
        ang = Math.atan2(path[1][0] - path[0][0], path[1][1] - path[0][1]);
      } else if (t < 1) {
        const k = (t - 0.55) / 0.45;
        px = path[1][0] + (path[2][0] - path[1][0]) * k;
        pz = path[1][1] + (path[2][1] - path[1][1]) * k;
        ang = Math.atan2(path[2][0] - path[1][0], path[2][1] - path[1][1]);
      } else {
        px = path[2][0]; pz = path[2][1];
        ang = Math.atan2(path[3][0] - path[2][0], path[3][1] - path[2][1]);
      }
      fireTruck.position.set(px, 0, pz);
      fireTruck.rotation.y = ang;
    }
  }

  if (secGroup.visible) {
    const t = now * 0.003;
    for (let i = 0; i < pulseRings.length; i++) {
      const k = 1 + Math.sin(t + i * 0.9) * 0.18;
      pulseRings[i].scale.set(k, k, 1);
    }
    for (let i = 0; i < conesGroup.children.length; i++) {
      conesGroup.children[i].material.opacity = 0.12 + Math.sin(now * 0.002) * 0.03;
    }
  }

  renderer.render(scene, camera);
}
animate();

/* Resize */
addEventListener('resize', function () {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

updHint();
