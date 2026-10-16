// 32-cast.js — BB.Cast: the cartoon cast, built from primitives with BB.Toon. Owned by the render agent.
// Every character shares one skeleton (Rocco units: ~4.9 ft tall at size 1) so every pose works on everyone; size,
// build, species heads, uniforms and gear make them different. Characters are built Y-up (+Z = facing, +X = their
// left) inside an "up" group that turns them into the Z-up world.
//
//   root (world: position, yaw)  -> spin (squash / corkscrew, Z-up)  -> up (Y-up, size, mirror for lefties)
//        up -> body (pose offset) -> pelvis (torso twist / lean) -> torso mesh, head (face kit, cap), tail
//        up -> hoses (rubber-hose arms & legs), hands, feet, held props
BB.Cast = (function () {
  var TN = BB.Toon; if (!TN) return null;
  var T = THREE, U = BB.U, P = TN.P, INK = TN.INK, M = TN.M;
  var PI = Math.PI;

  // ------------------------------------------------------------------ skeleton (Rocco units)
  var SK = {
    hip: 1.36, armL: 1.3, legL: 1.36,
    sho: [0.48, 1.08, 0.0], hipj: [0.26, -0.06, 0.0], neck: [0, 1.3, 0.03], headY: 0.66, headS: 1.22,
  };

  // ------------------------------------------------------------------ species
  var WHITE = '#FFF9EE', CREAM = '#FFF4DC', PINK = '#F2A8B0', DARK = '#2F2A38';
  var SPECIES = {
    raccoon: { eyeZ: 0.5, fur: '#9A97A6', fur2: '#F6F1E8', dark: '#2E2A38', ear: 'pointy', earIn: '#F6F1E8', snout: [0.3, 0.2, 0.3], mask: 1, cheeks: 1, tail: 'ring' },
    ox: { fur: '#8A5A3C', fur2: '#EBB8A0', ear: 'side', snout: [0.44, 0.3, 0.3], nose: '#C47C6A', horns: 'ox', tuft: '#5A3A28', nostrils: 1 },
    bear: { fur: '#7A4E32', fur2: '#D9B48C', ear: 'round', snout: [0.32, 0.23, 0.32], tail: 'nub' },
    goat: { fur: '#EDE6D6', fur2: '#DCCDB2', ear: 'droop', snout: [0.24, 0.26, 0.38], horns: 'goat', beard: 1, nose: '#C98C7A' },
    walrus: { fur: '#A8705A', fur2: '#C99178', ear: 'none', snout: [0.46, 0.28, 0.3], tusks: 1, whisk: 1, eyeS: 0.8 },
    seal: { fur: '#8C96A3', fur2: '#C2C9D2', ear: 'none', snout: [0.34, 0.21, 0.28], whisk: 1 },
    possum: { fur: '#C9C6CC', fur2: '#F6F1E8', ear: 'roundbig', earIn: PINK, snout: [0.2, 0.18, 0.44], nose: PINK, tail: 'thin' },
    rat: { fur: '#8A8590', fur2: '#BDB6C2', ear: 'roundbig', earIn: PINK, snout: [0.2, 0.18, 0.44], nose: PINK, tail: 'thin', teeth: 1 },
    bulldog: { fur: '#D9B38C', fur2: '#F6F1E8', ear: 'fold', snout: [0.48, 0.3, 0.24], jowls: 1, underbite: 1 },
    beaver: { fur: '#8A5A36', fur2: '#C99A6C', ear: 'tiny', snout: [0.32, 0.22, 0.28], teeth: 1, tail: 'flat' },
    moose: { fur: '#6E4A30', fur2: '#9A7656', ear: 'side', snout: [0.36, 0.32, 0.5], antlers: 1, nose: '#3B2A22' },
    badger: { fur: '#8C8C94', fur2: '#F6F1E8', dark: '#2F2A38', ear: 'tiny', snout: [0.24, 0.2, 0.38], stripe: 1 },
    armadillo: { fur: '#C9A27E', fur2: '#E6CBAB', ear: 'tall', snout: [0.17, 0.16, 0.5], shell: 'band', shellC: '#A0785A' },
    tortoise: { fur: '#8DB65A', fur2: '#BCD88E', ear: 'none', snout: [0.3, 0.2, 0.24], shell: 'dome', shellC: '#6B8A3E' },
    rhino: { fur: '#9A9AA6', fur2: '#B8B8C2', ear: 'tall', snout: [0.4, 0.3, 0.42], horn: 1 },
    hippo: { fur: '#9A86B0', fur2: '#CDB6DA', ear: 'tiny', snout: [0.52, 0.36, 0.36], nostrils: 1, eyeS: 0.85 },
    sheep: { fur: '#FBF6EA', fur2: '#4A4050', face: '#4A4050', ear: 'side', snout: [0.24, 0.22, 0.3], wool: 1, nose: '#2F2A38' },
    squirrel: { fur: '#D9783B', fur2: '#F6E4C8', ear: 'pointy', earIn: '#F6E4C8', snout: [0.22, 0.18, 0.3], tail: 'bushy', teeth: 1 },
    lizard: { fur: '#5FB04A', fur2: '#BCDC7C', ear: 'none', snout: [0.3, 0.2, 0.32], casque: 1, tail: 'curl', eyeSide: 1 },
    fox: { fur: '#E07B39', fur2: '#FBF4EA', ear: 'pointy', earIn: DARK, snout: [0.2, 0.18, 0.44], tail: 'bushy', tipC: '#FBF4EA' },
    otter: { fur: '#7A5236', fur2: '#D2AE88', ear: 'tiny', snout: [0.32, 0.2, 0.26], whisk: 1, tail: 'thin' },
    mole: { fur: '#4F475A', fur2: '#655B70', ear: 'none', snout: [0.18, 0.16, 0.42], nose: PINK, eyeS: 0.6 },
    loon: { bird: 1, fur: '#2C2C36', fur2: '#F6F1E8', beak: [0.09, 0.6, '#2C2C36'], eyeC: '#D9483B', necklace: 1 },
    gull: { bird: 1, fur: '#FBF8F2', fur2: '#B9C1CB', beak: [0.1, 0.46, '#F2B632'], beakDot: '#D9483B' },
    pelican: { bird: 1, fur: '#F6F1E8', fur2: '#E3D9C6', beak: [0.11, 0.95, '#F2B632'], pouch: '#F29E5E' },
    owl: { bird: 1, fur: '#9A6A44', fur2: '#ECD6B2', beak: [0.08, 0.18, '#F2B632'], disc: 1, tufts: 1, eyeS: 1.15 },
    rooster: { bird: 1, fur: '#FBF8F2', fur2: '#F2E6CC', beak: [0.1, 0.3, '#F2B632'], comb: '#D9483B' },
    pigeon: { bird: 1, fur: '#8C93A8', fur2: '#6FA39A', beak: [0.07, 0.26, '#3B3340'], cere: 1 },
    goose: { bird: 1, fur: '#FBF8F2', fur2: '#E6E1D6', beak: [0.1, 0.42, '#F28C38'], knob: 1 },
    flamingo: { bird: 1, fur: '#F29EB4', fur2: '#F7C4D0', beak: [0.1, 0.44, '#F6F1E8'], beakTip: '#2C2C36' },
    eagle: { bird: 1, fur: '#FBF8F2', fur2: '#6E4A30', beak: [0.13, 0.42, '#F2B632'], hook: 1, heavyBrow: 1 },
  };
  // one species per pitcher, from the name or nickname
  var PITCHER_SPECIES = {
    p_hank: 'rooster', p_dottie: 'flamingo', p_clem: 'pelican', p_ox: 'ox',
    p_vinnie: 'possum', p_rosalind: 'pigeon', p_marty: 'rat', p_landlord: 'bulldog',
    p_ellis: 'beaver', p_june: 'loon', p_otis: 'moose', p_sasquatch: 'bear',
    p_pearl: 'goose', p_nils: 'seal', p_sully: 'gull', p_admiral: 'walrus',
    p_rio: 'armadillo', p_tess: 'tortoise', p_cosmo: 'owl', p_mirage: 'lizard',
    p_organist: 'badger', p_belle: 'goat', p_thunder: 'rhino', p_halo: 'eagle',
    p_bpbob: 'hippo', p_mabel: 'sheep', p_ike: 'squirrel',
  };
  var SPECIES_ALIAS = { hen: 'rooster', dog: 'bulldog', cat: 'possum', bison: 'rhino', peacock: 'eagle' };
  var FALLBACK = ['bear', 'goat', 'owl', 'badger', 'walrus', 'rooster', 'moose', 'possum', 'gull', 'bulldog'];
  function speciesFor(p) {
    if (!p) return 'bear';
    if (p.species && SPECIES[p.species]) return p.species;   // BB.Content is the source of truth (same as the cards)
    if (p.species && SPECIES_ALIAS[p.species]) return SPECIES_ALIAS[p.species];
    if (PITCHER_SPECIES[p.id]) return PITCHER_SPECIES[p.id];
    var s = ((p.nick || '') + ' ' + (p.name || '')).toLowerCase();
    for (var k in SPECIES) if (s.indexOf(k) >= 0) return k;
    return FALLBACK[U.hashStr(p.id || p.name || 'x') % FALLBACK.length];
  }
  var TEAM = { Hayseeds: '#C8452F', Rivets: '#6B4FA0', Loons: '#2F7A4A', Gulls: '#1F6E8C', Coyotes: '#D9783B', Copperheads: '#B5652F', Barnstormers: '#2B4A8C' };
  function teamColor(team) { return TEAM[team] || ['#C8452F', '#2B4A8C', '#2F7A4A', '#6B4FA0'][U.hashStr(team || 'x') % 4]; }

  // ------------------------------------------------------------------ text decals (numbers, letters)
  var decalCache = {};
  function decalTex(text, fill, edge) {
    var k = text + fill + edge;
    if (decalCache[k]) return decalCache[k];
    var t = TN.canvasTex(128, 128, function (x, w, h) {
      x.font = '92px ' + BB.FONTS.display; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      x.lineWidth = 14; x.strokeStyle = edge; x.strokeText(text, w / 2, h / 2 + 6);
      x.fillStyle = fill; x.fillText(text, w / 2, h / 2 + 6);
    });
    decalCache[k] = t;
    return t;
  }

  function ownMat(o) { var m = new T.MeshToonMaterial(o); m.userData.own = true; return m; }

  // ------------------------------------------------------------------ head
  // Head-local: origin = head centre, +Z = face. Returns face anchors.
  function buildHead(b, sp, o) {
    var lo = o.simple, fur = sp.fur, f2 = sp.fur2, hs = sp.bird ? 0.95 : 1;
    var R = [0.66 * hs, 0.6 * hs, 0.6 * hs];
    if (sp.wool) { // sheep: dark face in a cloud of wool
      b.ell(sp.face, [0, -0.05, 0.12], [0.5, 0.58, 0.5], null, { lo: lo });
      for (var w = 0; w < 9; w++) { var a = w / 9 * PI * 2; b.ell(sp.fur, [Math.cos(a) * 0.48, 0.25 + Math.sin(a) * 0.3, -0.1 + Math.abs(Math.sin(a)) * 0.05], [0.3, 0.3, 0.3], null, { lo: true }); }
      b.ell(sp.fur, [0, 0.42, 0.18], [0.4, 0.26, 0.34], null, { lo: lo });
    } else b.ell(fur, [0, 0, 0], R, null, { lo: lo });
    var eyeS = sp.eyeS || 1, ex = 0.2, ey = 0.08, ez = 0.47;
    if (sp.bird) {
      var bk = sp.beak, len = bk[1], br = bk[0] * 1.6;
      if (sp.disc) b.ell(sp.fur2, [0, 0.0, 0.32], [0.56, 0.5, 0.3], null, { lo: lo });
      // upper beak
      var hook = sp.hook ? 0.25 : 0;
      b.add(P.cone(10), bk[2], [[0, -0.06, 0.52 + len / 2], [PI / 2 + hook * 0.3, 0, 0], [br, len, br * 0.7]], { ow: 0.8 });
      if (sp.beakTip) b.add(P.cone(10), sp.beakTip, [[0, -0.06 - len * 0.12, 0.52 + len * 0.86], [PI / 2 + 0.5, 0, 0], [br * 0.42, len * 0.3, br * 0.4]], { ow: 0.6 });
      if (sp.beakDot) b.ell(sp.beakDot, [0, -0.1, 0.52 + len * 0.6], [0.05, 0.05, 0.05], null, { ow: 0 });
      if (sp.knob) b.ell('#2C2C36', [0, 0.0, 0.58], [0.08, 0.07, 0.08], null, { ow: 0.5 });
      if (sp.cere) b.ell('#F6F1E8', [0, -0.0, 0.6], [0.07, 0.04, 0.06], null, { ow: 0 });
      if (sp.comb) { for (var c = 0; c < 3; c++) b.ell(sp.comb, [0, 0.58 + (c === 1 ? 0.08 : 0), 0.22 - c * 0.2], [0.07, 0.17, 0.11], null, { lo: true }); b.ell(sp.comb, [0, -0.38, 0.5], [0.07, 0.14, 0.07], null, { lo: true }); }
      if (sp.tufts) [-1, 1].forEach(function (s) { b.add(P.cone(8), fur, [[s * 0.38, 0.58, 0.0], [0, 0, -s * 0.5], [0.12, 0.34, 0.1]]); });
      if (sp.necklace) b.add(P.torus(0.06, PI * 2, 18), sp.fur2, [[0, -0.5, 0.0], [PI / 2, 0, 0], [0.48, 0.48, 0.48]], { ow: 0.4 });
      if (sp.heavyBrow) b.ell(fur, [0, 0.22, 0.42], [0.5, 0.12, 0.2], null, { ow: 0.5 });
      if (sp.necklace) ez = 0.47;
      ey = 0.12;
    } else {
      var sn = sp.snout, sz = 0.42 + sn[2] * 0.25;
      if (sp.cheeks) [-1, 1].forEach(function (s) { b.ell(sp.fur2, [s * 0.5, -0.2, 0.14], [0.26, 0.19, 0.24], [0, 0, -s * 0.5], { lo: lo }); b.add(P.cone(6), sp.fur2, [[s * 0.66, -0.26, 0.12], [0, 0, s * 2.1], [0.09, 0.16, 0.09]], { ow: 0.7 }); });
      if (sp.jowls) [-1, 1].forEach(function (s) { b.ell(sp.fur2, [s * 0.24, -0.3, 0.42], [0.26, 0.24, 0.24], null, { lo: lo }); });
      if (sp.mask) {
        [-1, 1].forEach(function (s) { b.ell(sp.dark, [s * 0.25, 0.06, 0.42], [0.29, 0.2, 0.16], [0, 0, s * 0.3], { lo: lo, ow: 0 }); });
        b.ell(sp.fur2, [0, 0.31, 0.44], [0.3, 0.09, 0.14], null, { lo: true, ow: 0 }); // white brow band
      }
      if (sp.stripe) { b.ell(sp.fur2, [0, 0.2, 0.25], [0.15, 0.48, 0.42], null, { lo: lo, ow: 0 }); [-1, 1].forEach(function (s) { b.ell(sp.dark, [s * 0.32, 0.06, 0.38], [0.14, 0.32, 0.18], [0, 0, s * 0.3], { lo: true, ow: 0 }); }); }
      if (sp.casque) b.ell(fur, [0, 0.42, -0.12], [0.3, 0.32, 0.5], [0.5, 0, 0], { lo: lo });
      // muzzle
      b.ell(sp.fur2, [0, -0.2, sz], [sn[0], sn[1], sn[2]], null, { lo: lo, ow: 0.9 });
      if (sp.underbite) { [-1, 1].forEach(function (s) { b.add(P.cone(6), WHITE, [[s * 0.14, -0.26, sz + sn[2] * 0.85], [0, 0, 0], [0.04, 0.12, 0.04]], { ow: 0.5 }); }); }
      var nz = sz + sn[2] * 0.92;
      b.ell(sp.nose || INK, [0, -0.1, nz], [Math.min(0.13, sn[0] * 0.42), 0.09, 0.08], null, { ow: 0.6, lo: true });
      if (sp.nostrils) [-1, 1].forEach(function (s) { b.ell(INK, [s * 0.14, -0.14, nz - 0.02], [0.04, 0.05, 0.04], null, { ow: 0, lo: true }); });
      if (sp.horn) b.add(P.cone(10), CREAM, [[0, 0.02, sz + sn[2] * 0.6], [-0.4, 0, 0], [0.12, 0.42, 0.12]]);
      if (sp.tusks) [-1, 1].forEach(function (s) { b.add(P.cone(8), WHITE, [[s * 0.16, -0.5, sz + 0.1], [PI - 0.15, 0, 0], [0.06, 0.38, 0.06]], { ow: 0.7 }); });
      if (sp.whisk) [-1, 1].forEach(function (s) { for (var k = 0; k < 3; k++) b.ell(INK, [s * (0.16 + k * 0.06), -0.16 + (k - 1) * 0.05, sz + sn[2] * 0.8], [0.018, 0.018, 0.018], null, { ow: 0, lo: true }); });
      if (sp.beard) b.add(P.cone(8), sp.fur2, [[0, -0.48, sz - 0.02], [PI, 0, 0], [0.12, 0.34, 0.1]]);
      if (sp.tuft) b.ell(sp.tuft, [0, 0.52, 0.18], [0.24, 0.12, 0.2], null, { lo: true });
      // ears
      var ear = sp.ear, ein = sp.earIn || sp.fur2;
      [-1, 1].forEach(function (s) {
        if (ear === 'pointy') { b.add(P.cone(8), fur, [[s * 0.4, 0.55, -0.05], [0, 0, -s * 0.38], [0.2, 0.42, 0.13]]); b.add(P.cone(8), ein, [[s * 0.41, 0.53, 0.02], [0, 0, -s * 0.38], [0.12, 0.28, 0.06]], { ow: 0 }); }
        else if (ear === 'round') { b.ell(fur, [s * 0.45, 0.5, -0.05], [0.2, 0.2, 0.09]); b.ell(sp.fur2, [s * 0.45, 0.5, 0.0], [0.11, 0.11, 0.06], null, { ow: 0 }); }
        else if (ear === 'roundbig') { b.ell(fur, [s * 0.5, 0.52, -0.05], [0.3, 0.3, 0.07]); b.ell(ein, [s * 0.5, 0.52, 0.0], [0.2, 0.2, 0.05], null, { ow: 0 }); }
        else if (ear === 'tiny') b.ell(fur, [s * 0.42, 0.46, -0.05], [0.12, 0.12, 0.08], null, { lo: true });
        else if (ear === 'side') { b.ell(fur, [s * 0.7, 0.18, -0.05], [0.22, 0.1, 0.12], [0, 0, s * 0.3]); b.ell(ein, [s * 0.72, 0.18, 0.0], [0.13, 0.05, 0.06], [0, 0, s * 0.3], { ow: 0, lo: true }); }
        else if (ear === 'droop') b.ell(fur, [s * 0.66, 0.0, -0.02], [0.13, 0.3, 0.1], [0, 0, s * 0.5]);
        else if (ear === 'fold') b.ell(fur, [s * 0.5, 0.42, 0.0], [0.17, 0.14, 0.09], [0.4, 0, s * 0.9]);
        else if (ear === 'tall') b.ell(fur, [s * 0.36, 0.62, -0.05], [0.1, 0.24, 0.08], [0, 0, -s * 0.25]);
      });
      if (sp.horns === 'ox') [-1, 1].forEach(function (s) { b.add(P.cone(10), CREAM, [[s * 0.72, 0.42, 0.0], [0, 0, -s * 1.1], [0.1, 0.5, 0.1]]); });
      if (sp.horns === 'goat') [-1, 1].forEach(function (s) { b.add(P.cone(10), '#B5A88E', [[s * 0.22, 0.62, -0.22], [-0.9, 0, -s * 0.15], [0.09, 0.5, 0.09]]); });
      if (sp.antlers) [-1, 1].forEach(function (s) {
        b.add(P.cyl(1, 1, 8), '#E9D8B6', [[s * 0.55, 0.6, -0.05], [0, 0, -s * 1.0], [0.05, 0.4, 0.05]]);
        b.ell('#E9D8B6', [s * 0.92, 0.88, -0.05], [0.34, 0.2, 0.06], [0, 0, -s * 0.5]);
        for (var k = 0; k < 3; k++) b.add(P.cone(6), '#E9D8B6', [[s * (0.72 + k * 0.17), 1.05 + k * 0.04, -0.05], [0, 0, -s * 0.2], [0.05, 0.22, 0.04]], { ow: 0.7 });
      });
      ez = sp.eyeZ || 0.46; ey = 0.1;
      if (sp.eyeSide) { ex = 0.36; ez = 0.36; }
    }
    if (sp.teeth) b.add(P.box(), WHITE, [[0, -0.37, 0.42 + sp.snout[2] * 0.25 + sp.snout[2] * 0.75], [0.1, 0, 0], [0.16, 0.12, 0.05]], { ow: 0.7 });
    return { eyeX: ex, eyeY: ey, eyeZ: ez, eyeS: eyeS, mouthY: sp.bird ? -0.12 : -0.36, mouthZ: sp.bird ? 0.5 : 0.42 + (sp.snout ? sp.snout[2] * 0.7 : 0.25) };
  }

  // eyes / pupils / brows / mouth as separate small meshes (so faces can act)
  function faceKit(ch, head, a, sp, o) {
    var es = a.eyeS, ex = a.eyeX, ey = a.eyeY, ez = a.eyeZ;
    var b = new TN.Builder();
    [-1, 1].forEach(function (s) { b.ell(WHITE, [s * ex, ey, ez], [0.15 * es, 0.2 * es, 0.1 * es], sp.eyeSide ? [0, s * 0.6, 0] : null); });
    var eyes = TN.inked(b.build(), null, true);
    eyes.userData.outline.material = TN.OUTLINE;
    head.add(eyes);
    var pb = new TN.Builder(), pc = sp.eyeC || INK;
    [-1, 1].forEach(function (s) {
      var px = s * (ex - 0.01) + (sp.eyeSide ? s * 0.06 : 0);
      pb.ell(pc, [px, ey - 0.02, ez + 0.085 * es], [0.075 * es, 0.105 * es, 0.04], null, { ow: 0, lo: true });
      if (pc !== INK) pb.ell(INK, [px, ey - 0.02, ez + 0.1 * es], [0.04 * es, 0.06 * es, 0.03], null, { ow: 0, lo: true });
      pb.ell(WHITE, [px + 0.03, ey + 0.03, ez + 0.12 * es], [0.025, 0.03, 0.02], null, { ow: 0, lo: true });
    });
    var pupils = new T.Mesh(pb.build(), TN.VC);
    eyes.add(pupils);
    eyes.position.set(0, 0, 0);
    // brows
    var brows = [-1, 1].map(function (s) {
      var bb = new TN.Builder();
      bb.add(P.capsule(0.035, 0.18), sp.heavyBrow ? DARK : INK, [[0, 0, 0], [0, 0, PI / 2], 1], { ow: 0 });
      var m = new T.Mesh(bb.build(), TN.VC);
      m.position.set(s * ex, ey + 0.23 * es, ez + 0.06);
      head.add(m);
      m.userData.side = s; m.userData.base = m.position.y;
      return m;
    });
    // mouth: a smile line and an open mouth (dark with a tongue)
    var mb = new TN.Builder();
    mb.add(P.torus(0.13, PI, 14), INK, [[0, 0, 0], [0, 0, PI], [0.16, 0.12, 0.12]], { ow: 0 });
    var smile = new T.Mesh(mb.build(), TN.VC);
    var ob = new TN.Builder();
    ob.ell('#5A1E2A', [0, 0, 0], [0.15, 0.12, 0.06], null, { ow: 1 });
    ob.ell('#E8707A', [0, -0.06, 0.03], [0.09, 0.05, 0.04], null, { ow: 0 });
    ob.add(P.box(), WHITE, [[0, 0.08, 0.035], null, [0.16, 0.04, 0.03]], { ow: 0 });
    var open = TN.inked(ob.build());
    var mouth = new T.Group();
    mouth.add(smile); mouth.add(open);
    mouth.position.set(0, a.mouthY, a.mouthZ + 0.02);
    if (sp.bird) mouth.visible = false;
    head.add(mouth);
    ch.eyes = eyes; ch.pupils = pupils; ch.brows = brows; ch.mouth = mouth; ch.smile = smile; ch.open = open;
    if (sp.bird) { // lower beak = the jaw
      var jb = new TN.Builder(), bk = sp.beak, len = bk[1] * 0.85, br = bk[0] * 1.4;
      jb.add(P.cone(10), sp.pouch || bk[2], [[0, 0, len / 2], [PI / 2, 0, 0], [br, len, sp.pouch ? br * 1.6 : br * 0.5]], { ow: 0.8 });
      var jaw = TN.inked(jb.build());
      jaw.position.set(0, -0.16, 0.5);
      if (sp.pouch) jaw.position.y = -0.2;
      head.add(jaw);
      ch.jaw = jaw;
    }
  }

  function buildCap(color, brim, opts) {
    var b = new TN.Builder();
    b.add(P.hemi(), color, [[0, 0, 0], [-0.12, 0, 0], [0.64, 0.42, 0.64]]);
    b.add(P.cyl(1, 1, 18), brim, [[0, 0.03, 0.62], [-0.1, 0, 0], [0.4, 0.04, 0.44]], { ow: 0.9 });
    b.ell(brim, [0, 0.41, -0.05], [0.07, 0.04, 0.07], null, { lo: true, ow: 0.5 });
    if (opts && opts.letter) {
      // logo patch on the front
      b.ell(opts.letterBg || WHITE, [0, 0.22, 0.6], [0.16, 0.14, 0.04], [-0.35, 0, 0], { ow: 0, lo: true });
    }
    return TN.inked(b.build());
  }

  // ------------------------------------------------------------------ the character
  function make(o) {
    o = o || {};
    var sp = SPECIES[o.species] || SPECIES.raccoon, lo = !!o.simple;
    var ch = { o: o, sp: sp, sk: SK };
    var root = ch.root = new T.Group();
    var spin = ch.spin = new T.Group(); root.add(spin);
    var up = ch.up = new T.Group(); up.rotation.x = PI / 2; spin.add(up);
    var sz = o.size || 1; up.scale.set(o.mirror ? -sz : sz, sz, sz);
    var body = ch.body = new T.Group(); up.add(body);
    var pelvis = ch.pelvis = new T.Group(); pelvis.rotation.order = 'YXZ'; pelvis.position.y = SK.hip; body.add(pelvis);

    var shirt = o.shirt || '#C9C6C0', pants = o.pants || shirt, trim = o.trim || '#2B4A8C', socks = o.socks || trim, shoes = o.shoes || INK;
    var furArm = sp.bird ? sp.fur : sp.fur;
    // torso
    var bw = o.build === 'stout' ? [1.22, 0.96, 1.25] : o.build === 'lanky' ? [0.86, 1.08, 0.86] : o.build === 'tall' ? [0.98, 1.06, 1.0] : [1, 1, 1];
    var tb = new TN.Builder();
    tb.ell(pants, [0, 0.1, 0], [0.5 * bw[0], 0.42, 0.42 * bw[2]], null, { lo: lo });
    tb.ell(shirt, [0, 0.66 * bw[1], 0.02], [0.56 * bw[0], 0.6 * bw[1], 0.46 * bw[2]], null, { lo: lo });
    if (!lo) {
      tb.add(P.torus(0.07, PI * 2, 22), o.belt || INK, [[0, 0.26, 0], [PI / 2, 0, 0], [0.52 * bw[0], 0.44 * bw[2], 0.6]], { ow: 0 });
      tb.add(P.torus(0.07, PI * 2, 18), trim, [[0, 1.18 * bw[1], 0.0], [PI / 2 + 0.15, 0, 0], [0.26, 0.24, 0.6]], { ow: 0 });
      // placket stripe
      if (!o.letter) tb.add(P.box(), trim, [[0, 0.7 * bw[1], 0.44 * bw[2] + 0.005], [-0.05, 0, 0], [0.05, 0.78 * bw[1], 0.03]], { ow: 0 });
    }
    [-1, 1].forEach(function (s) { tb.ell(shirt, [s * SK.sho[0] * Math.max(0.95, bw[0] * 0.95), SK.sho[1] - 0.05, 0], [0.2, 0.2, 0.2], null, { lo: true }); });
    if (o.chestPad) tb.ell(o.chestPad, [0, 0.7, 0.18], [0.5 * bw[0], 0.54, 0.34 * bw[2]], null, { lo: lo });
    if (sp.shell === 'dome') tb.ell(sp.shellC, [0, 0.65, -0.32], [0.6 * bw[0], 0.65, 0.42], null, { lo: lo });
    if (sp.shell === 'band') for (var bi = 0; bi < 4; bi++) tb.ell(sp.shellC, [0, 0.3 + bi * 0.24, -0.26], [0.56 * bw[0], 0.16, 0.36], null, { lo: true });
    if (sp.bird) tb.ell(sp.fur, [0, 1.08, 0.05], [0.3, 0.3, 0.28], null, { lo: true }); // neck
    else tb.ell(sp.fur, [0, 1.12, 0.04], [0.24, 0.2, 0.22], null, { lo: true });
    var torso = ch.torso = TN.inked(tb.build());
    pelvis.add(torso);
    // number on the back, letter on the chest
    if (o.number != null && !lo) {
      var patch = new T.SphereGeometry(1.03, 10, 6, PI * 1.5 - 0.6, 1.2, 0.95, 0.9);
      var nm = new T.Mesh(patch, ownMat({ map: decalTex(String(o.number), o.numColor || trim, o.numEdge || WHITE), transparent: true, alphaTest: 0.4, gradientMap: TN.GRAD, depthWrite: false }));
      nm.scale.set(0.56 * bw[0], 0.6 * bw[1], 0.46 * bw[2]); nm.position.set(0, 0.66 * bw[1], 0.02); nm.renderOrder = 2;
      pelvis.add(nm);
    }
    if (o.letter && !lo) {
      var patch2 = new T.SphereGeometry(1.03, 8, 6, PI * 0.5 - 0.42, 0.84, 0.75, 0.75);
      var lm = new T.Mesh(patch2, ownMat({ map: decalTex(o.letter, o.numColor || trim, o.numEdge || WHITE), transparent: true, alphaTest: 0.4, gradientMap: TN.GRAD, depthWrite: false }));
      lm.scale.set(0.56 * bw[0], 0.6 * bw[1], 0.46 * bw[2]); lm.position.set(0, 0.66 * bw[1], 0.02); lm.renderOrder = 2;
      pelvis.add(lm);
    }
    // tail
    if (sp.tail && sp.tail !== 'none') {
      var tl = new TN.Builder(), kind = sp.tail;
      if (kind === 'ring' || kind === 'bushy' || kind === 'thin' || kind === 'curl') {
        var n = kind === 'thin' ? 7 : 6;
        for (var i = 0; i < n; i++) {
          var u = i / (n - 1), ang = kind === 'curl' ? u * 4.2 : u * 1.1;
          var py = 0.05 + Math.sin(ang) * (kind === 'curl' ? 0.35 : 0.9) * (kind === 'curl' ? 1 : u + 0.2);
          var pz = -0.45 - (kind === 'curl' ? (1 - Math.cos(ang)) * 0.35 + u * 0.2 : u * 0.9);
          var r = kind === 'thin' ? 0.07 * (1 - u * 0.5) : kind === 'curl' ? 0.12 * (1 - u * 0.6) : (kind === 'bushy' ? 0.2 + 0.12 * Math.sin(u * PI) : 0.17 + 0.05 * Math.sin(u * PI));
          var col = kind === 'ring' ? (i % 2 ? sp.dark : sp.fur) : kind === 'thin' ? (sp.ear === 'roundbig' ? PINK : sp.fur) : (kind === 'bushy' && i === n - 1 && sp.tipC ? sp.tipC : sp.fur);
          tl.ell(col, [0, py, pz], [r, r, r * 1.15], null, { lo: true, ow: kind === 'ring' ? 0.8 : 1 });
        }
      } else if (kind === 'flat') tl.ell('#5A3A28', [0, 0.0, -0.75], [0.3, 0.07, 0.45], [0.3, 0, 0]);
      else if (kind === 'nub') tl.ell(sp.fur, [0, 0.1, -0.45], [0.12, 0.12, 0.12], null, { lo: true });
      ch.tail = TN.inked(tl.build());
      pelvis.add(ch.tail);
    }

    // head
    var head = ch.head = new T.Group(); head.rotation.order = 'YXZ';
    head.position.set(SK.neck[0], SK.neck[1], SK.neck[2]);
    pelvis.add(head);
    var hc = new T.Group(); hc.position.y = SK.headY; head.add(hc); ch.headC = hc;
    hc.scale.setScalar((o.headScale || 1) * SK.headS);
    var hb = new TN.Builder();
    var anchors = buildHead(hb, sp, o);
    if (lo) { // simple figures: eyes baked into the head
      [-1, 1].forEach(function (s) {
        hb.ell(WHITE, [s * anchors.eyeX, anchors.eyeY, anchors.eyeZ], [0.15, 0.2, 0.1], null, { lo: true, ow: 0.6 });
        hb.ell(INK, [s * anchors.eyeX, anchors.eyeY - 0.02, anchors.eyeZ + 0.09], [0.08, 0.11, 0.04], null, { lo: true, ow: 0 });
      });
    }
    var headMesh = TN.inked(hb.build());
    hc.add(headMesh); ch.headMesh = headMesh;
    if (!lo) faceKit(ch, hc, anchors, sp, o);
    if (o.cap !== false && !sp.wool) {
      var cap = buildCap(o.cap || trim, o.brim || o.cap || trim, { letter: o.letter, letterBg: o.capPatch });
      var capG = new T.Group(); capG.position.set(0, sp.bird ? 0.24 : 0.3, -0.04); capG.add(cap);
      if (sp.ear === 'pointy' || sp.ear === 'roundbig' || sp.ear === 'tall') cap.scale.set(0.92, 0.95, 0.95);
      if (sp.antlers || sp.horns) cap.scale.set(0.85, 0.85, 0.85);
      if (sp.comb) { capG.position.z = 0.12; capG.position.y = 0.2; }
      hc.add(capG); ch.cap = capG;
    }
    if (o.mask) { // catcher / umpire face cage
      var mk = new TN.Builder();
      mk.add(P.torus(0.03, PI * 1.2, 16), '#3A3A44', [[0, -0.05, 0.5], [0, 0, -PI * 0.1 + PI], [0.42, 0.5, 0.4]], { ow: 0.6 });
      for (var g = 0; g < 3; g++) mk.add(P.box(), '#3A3A44', [[0, 0.12 - g * 0.18, 0.66 + (g === 2 ? -0.04 : 0)], null, [0.72, 0.04, 0.04]], { ow: 0.6 });
      mk.add(P.box(), '#3A3A44', [[0, -0.1, 0.68], null, [0.04, 0.5, 0.04]], { ow: 0.6 });
      var mask = TN.inked(mk.build()); hc.add(mask); ch.maskMesh = mask;
    }

    // limbs
    var armCols = [[0, shirt], [0.16, furArm]];
    var legCols = o.shinPads ? [[0, pants], [0.42, o.shinPads]] : [[0, pants], [0.5, socks], [0.66, socks]];
    var ar = lo ? 0.13 : 0.11, lr = lo ? 0.15 : 0.13;
    var hopts = { ring: lo ? 6 : 8, seg: lo ? 5 : 9 };
    ch.armL = new TN.Hose(ar * 1.1, ar, armCols, hopts); ch.armR = new TN.Hose(ar * 1.1, ar, armCols, hopts);
    ch.legL = new TN.Hose(lr * 1.15, lr * 0.92, legCols, hopts); ch.legR = new TN.Hose(lr * 1.15, lr * 0.92, legCols, hopts);
    [ch.armL, ch.armR, ch.legL, ch.legR].forEach(function (h) {
      // limbs always stay within a few units of the body: give them a fixed bound so frustum culling works
      h.geom.boundingSphere = new T.Sphere(new T.Vector3(0, 1.6, 0), 4.2);
      h.mesh.frustumCulled = true; if (h.mesh.userData.outline) h.mesh.userData.outline.frustumCulled = true;
      up.add(h.mesh);
    });

    // hands (white cartoon gloves; leather mitt on the glove hand)
    function hand(isMitt) {
      var b = new TN.Builder();
      if (isMitt) {
        var big = o.glove === 'C' ? 1.25 : 1;
        b.ell(o.mittC || '#A0582E', [0, 0.05, 0.02], [0.27 * big, 0.31 * big, 0.13 * big], null, { lo: lo });
        b.ell('#7A3E20', [0, 0.06, 0.1 * big], [0.17 * big, 0.2 * big, 0.06], null, { lo: true, ow: 0 });
        b.ell(o.mittC || '#A0582E', [0.22 * big, -0.06, 0.04], [0.09, 0.16, 0.09], [0, 0, 0.6], { lo: true });
      } else {
        b.ell(WHITE, [0, 0, 0.02], [0.17, 0.16, 0.19], null, { lo: lo });
        if (!lo) {
          b.ell(WHITE, [0.13, 0.04, 0.08], [0.07, 0.1, 0.07], [0, 0, -0.5], { lo: true });
          for (var f = 0; f < 3; f++) b.ell(WHITE, [-0.08 + f * 0.07, -0.04, 0.18], [0.045, 0.05, 0.07], null, { lo: true, ow: 0.5 });
          b.add(P.torus(0.06, PI * 2, 14), WHITE, [[0, 0, -0.12], null, [0.15, 0.15, 0.15]]);
        }
      }
      var g = new T.Group(); g.add(TN.inked(b.build())); up.add(g); return g;
    }
    var gl = o.glove || null; // 'L' / 'C' (catcher, left)
    ch.handL = hand(gl === 'L' || gl === 'C'); ch.handR = hand(gl === 'R');
    function foot() {
      var b = new TN.Builder();
      b.ell(shoes, [0, 0.04, 0.12], [0.2, 0.15, 0.34], null, { lo: lo });
      b.ell(o.sole || WHITE, [0, -0.05, 0.12], [0.21, 0.05, 0.35], null, { lo: true, ow: 0.8 });
      if (!lo) b.ell(o.shoeTip || shoes, [0, 0.07, 0.34], [0.12, 0.08, 0.09], null, { lo: true, ow: 0 });
      var g = new T.Group(); g.add(TN.inked(b.build())); up.add(g); return g;
    }
    ch.footL = foot(); ch.footR = foot();

    // blob shadow (world, flat on the ground under the root)
    var sh = new T.Mesh(SHADOW_G, SHADOW_M); sh.renderOrder = -1;
    sh.scale.set(1.1 * sz, 0.9 * sz, 1); root.add(sh); ch.shadow = sh;

    ch.pose = {};
    apply(ch, {});
    return ch;
  }
  var SHADOW_G = new T.CircleGeometry(1, 20);
  var SHADOW_M = new T.MeshBasicMaterial({ color: 0x1B1420, transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -40 });

  // ------------------------------------------------------------------ posing
  var DEF = {
    x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sq: 1, spin: 0, lean: 0, hip: SK.hip, tx: 0, ty: 0, tz: 0, hx: 0, hy: 0, hz: 0,
    lh: [0.62, 1.05, 0.12], rh: [-0.62, 1.05, 0.12], le: [0.6, -0.2, -0.6], re: [-0.6, -0.2, -0.6],
    lf: [0.3, 0.13, 0.0], rf: [-0.3, 0.13, 0.0], lk: [0.15, 0, 1], rk: [-0.15, 0, 1], lfy: 0, rfy: 0, lft: 0, rft: 0,
    lhr: [0, 0, 0], rhr: [0, 0, 0],
    brow: 0, browY: 0, mouth: 0, smile: 1, blink: 0, lx: 0, ly: 0, jaw: 0, tail: 0, cap: 0,
  };
  function lerpPose(a, b, u) {
    var o = {}, k;
    for (k in a) o[k] = a[k];
    for (k in b) {
      var va = a[k] != null ? a[k] : DEF[k], vb = b[k];
      if (Array.isArray(vb)) { va = va || vb; o[k] = [va[0] + (vb[0] - va[0]) * u, va[1] + (vb[1] - va[1]) * u, va[2] + (vb[2] - va[2]) * u]; }
      else if (typeof vb === 'number') o[k] = (va == null ? vb : va + (vb - va) * u);
      else o[k] = u < 0.5 && a[k] !== undefined ? a[k] : vb;
    }
    return o;
  }
  // keys: [[time, pose, ease?], ...] sorted; ease: 'in' | 'out' | 'lin' | default smooth
  function sample(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        var a = keys[i - 1], b = keys[i], u = (t - a[0]) / (b[0] - a[0] || 1), e = b[2];
        u = e === 'lin' ? u : e === 'in' ? u * u * u : e === 'out' ? 1 - Math.pow(1 - u, 3) : e === 'back' ? backOut(u) : u * u * (3 - 2 * u);
        return lerpPose(a[1], b[1], u);
      }
    }
    return keys[keys.length - 1][1];
  }
  function backOut(u) { var s = 1.9; u -= 1; return u * u * ((s + 1) * u + s) + 1; }

  var _mat = new T.Matrix4(), _v = new T.Vector3();
  function pt(local, m) { _v.set(local[0], local[1], local[2]).applyMatrix4(m); return [_v.x, _v.y, _v.z]; }
  function apply(ch, p) {
    var q = {}, k;
    for (k in DEF) q[k] = DEF[k];
    for (k in p) if (p[k] != null) q[k] = p[k];
    ch.pose = q;
    var sq = q.sq, ks = 1 / Math.sqrt(sq);
    ch.spin.scale.set(ks, ks, sq);
    ch.spin.rotation.set(0, 0, q.spin);
    ch.body.position.set(q.x, q.y, q.z);
    ch.body.rotation.set(q.rx, q.ry, q.rz);
    ch.pelvis.position.y = q.hip;
    ch.pelvis.rotation.set(q.tx, q.ty, q.tz);
    ch.head.rotation.set(q.hx, q.hy, q.hz);
    ch.body.updateMatrix(); ch.pelvis.updateMatrix();
    _mat.multiplyMatrices(ch.body.matrix, ch.pelvis.matrix);
    var sx = SK.sho[0], sy = SK.sho[1];
    var sL = pt([sx, sy, 0], _mat), sR = pt([-sx, sy, 0], _mat), hL = pt([SK.hipj[0], SK.hipj[1], 0], _mat), hR = pt([-SK.hipj[0], SK.hipj[1], 0], _mat);
    ch.handL.position.set(q.lh[0], q.lh[1], q.lh[2]); ch.handL.rotation.set(q.lhr[0], q.lhr[1], q.lhr[2]);
    ch.handR.position.set(q.rh[0], q.rh[1], q.rh[2]); ch.handR.rotation.set(q.rhr[0], q.rhr[1], q.rhr[2]);
    // aim the hands along the forearm direction for a little life
    ch.armL.limb(sL, q.lh, q.le, SK.armL); ch.armR.limb(sR, q.rh, q.re, SK.armL);
    ch.footL.position.set(q.lf[0], q.lf[1] - 0.08, q.lf[2]); ch.footL.rotation.set(q.lft, q.lfy, 0);
    ch.footR.position.set(q.rf[0], q.rf[1] - 0.08, q.rf[2]); ch.footR.rotation.set(q.rft, q.rfy, 0);
    ch.legL.limb(hL, [q.lf[0], q.lf[1] + 0.08, q.lf[2]], q.lk, SK.legL); ch.legR.limb(hR, [q.rf[0], q.rf[1] + 0.08, q.rf[2]], q.rk, SK.legL);
    // face
    if (ch.eyes) {
      ch.eyes.scale.y = Math.max(0.08, 1 - q.blink);
      ch.pupils.position.set(q.lx * 0.06, q.ly * 0.05, 0);
      ch.brows.forEach(function (m) {
        var s = m.userData.side;
        m.rotation.z = -s * q.brow * 0.45;
        m.position.y = m.userData.base + q.browY * 0.08 - Math.max(0, q.brow) * 0.03;
      });
      var open = q.mouth > 0.25;
      ch.smile.visible = !open; ch.open.visible = open;
      if (open) ch.open.scale.set(0.8 + 0.3 * q.mouth, 0.35 + q.mouth, 1);
      else { ch.smile.scale.set(0.6 + 0.6 * Math.abs(q.smile), q.smile >= 0 ? 1 : -1, 1); ch.smile.position.y = q.smile >= 0 ? 0 : -0.06; }
    }
    if (ch.jaw) ch.jaw.rotation.x = q.jaw * 0.7 + (q.mouth > 0.25 ? q.mouth * 0.4 : 0);
    if (ch.tail) ch.tail.rotation.y = q.tail;
    if (ch.cap) ch.cap.rotation.y = q.cap * PI;
    return q;
  }

  // ------------------------------------------------------------------ props
  function makeBat(o) {
    o = o || {};
    var pts = [], prof = [[0, 0.075], [0.06, 0.1], [0.1, 0.06], [0.9, 0.065], [1.6, 0.1], [2.25, 0.16], [2.75, 0.175], [2.92, 0.15], [2.96, 0.0]];
    prof.forEach(function (p) { pts.push(new T.Vector2(p[1], p[0])); });
    var g = new T.LatheGeometry(pts, 14);
    g.computeVertexNormals();
    var b = new TN.Builder();
    b.add(g, o.wood || '#D9A066', null);
    b.add(P.cyl(1, 1, 12, true), o.tape || INK, [[0, 0.5, 0], null, [0.078, 0.75, 0.078]], { ow: 0 });
    b.ell(o.tape || INK, [0, 0.02, 0], [0.11, 0.05, 0.11], null, { ow: 0.6, lo: true });
    if (o.stripe) b.add(P.cyl(1, 1, 14, true), o.stripe, [[0, 2.5, 0], null, [0.172, 0.12, 0.172]], { ow: 0 });
    g.dispose();
    var m = TN.inked(b.build());
    return m;
  }

  function makeBall() {
    var tex = TN.canvasTex(256, 128, function (x, w, h) {
      x.fillStyle = '#FFFDF6'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#D9483B'; x.lineWidth = 7; x.lineCap = 'round';
      for (var s = 0; s < 2; s++) {
        x.beginPath();
        for (var i = 0; i <= 64; i++) {
          var u = i / 64, px = u * w, py = h / 2 + Math.sin(u * Math.PI * 2 + s * Math.PI) * h * 0.28;
          if (i) x.lineTo(px, py); else x.moveTo(px, py);
        }
        x.stroke();
      }
      x.lineWidth = 3;
      for (s = 0; s < 2; s++) for (i = 1; i < 32; i++) {
        var uu = i / 32, cx = uu * w, cy = h / 2 + Math.sin(uu * Math.PI * 2 + s * Math.PI) * h * 0.28;
        x.beginPath(); x.moveTo(cx - 4, cy - 6); x.lineTo(cx + 4, cy - 2); x.stroke();
      }
    });
    var g = TN.prep(new T.SphereGeometry(1, 16, 12), 1);
    var mat = new T.MeshToonMaterial({ map: tex, gradientMap: TN.GRAD });
    var m = TN.inked(g, mat);
    return m;
  }

  return {
    SHADOW_G: SHADOW_G, SPECIES: SPECIES, PITCHER_SPECIES: PITCHER_SPECIES, speciesFor: speciesFor, teamColor: teamColor, TEAM: TEAM,
    make: make, apply: apply, sample: sample, lerpPose: lerpPose, DEF: DEF, SK: SK, makeBat: makeBat, makeBall: makeBall, decalTex: decalTex,
    backOut: backOut,
  };
})();
