# cspecs.py - character specs for the cast generator. A spec is plain data:
#   id, name, species, role (pitcher | catcher | fielder | umpire | runner), number, seed, boss,
#   face   - the card face params (BB.CardArt.face: palette, accessories, cap fwd/back)
#   colors - material colours (contract material names; team materials are recoloured by the runtime anyway)
#   build  - skeleton proportions (cskel.DEFAULT_BUILD keys), body - body shape (cbody.DEFAULT_BP keys)
#   head   - species head options, accessories - extra head accessories, tail - tail type (ctail), hands - (R, L)
#   gear   - [] | ['catcher'] | ['umpire']
# Card data comes from tools/blender/cast/data/cards.json (written by tools/cast-data.js from src/).
import os
import json
import colorsys
import copy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, 'data', 'cards.json')))
CARDS = {c['id']: c for c in DATA['cards']}
PITCHERS = {p['id']: p for p in DATA['pitchers']}
TEAMS = DATA['teams']

INK = '#1B1420'

# ------------------------------------------------------------------------------------------- body builds
# (skeleton build, body params): 1.0 = Rocco (5 ft, hips 1.70 ft)
BUILDS = {
    'average': ({}, {}),
    'stout': (dict(leg=0.96, torso=1.04, hipw=1.14, shoulderw=1.12, hand=1.08, head=1.02, foot=1.06),
              dict(chest_w=1.14, chest_d=1.12, belly=1.32, belly_drop=0.03, seat=1.14, thigh=1.18, shoulder=1.08,
                   arm_r=1.12, neck_r=1.08, cuff=1.08)),
    'lanky': (dict(leg=1.17, torso=1.07, hipw=0.9, shoulderw=0.94, arm=1.12, neck=1.15, foot=1.04),
              dict(chest_w=0.88, chest_d=0.9, belly=0.82, seat=0.88, thigh=0.84, shoulder=0.9, arm_r=0.88,
                   neck_r=0.88, cuff=0.9)),
    'tall': (dict(leg=1.13, torso=1.09, shoulderw=1.04, arm=1.07, hand=1.04, foot=1.06),
             dict(chest_w=1.0, chest_d=1.0, belly=0.95, arm_r=1.0)),
    'stocky': (dict(leg=0.92, torso=1.0, hipw=1.08, shoulderw=1.08, hand=1.05, foot=1.04),
               dict(chest_w=1.1, chest_d=1.08, belly=1.15, seat=1.08, thigh=1.12, shoulder=1.06, arm_r=1.08, cuff=1.04)),
    'round': (dict(leg=0.84, torso=0.96, hipw=1.12, shoulderw=1.0, arm=0.94, hand=1.0, foot=0.96),
              dict(chest_w=1.12, chest_d=1.15, belly=1.42, belly_drop=0.05, seat=1.18, thigh=1.12, arm_r=1.04)),
    'small': (dict(leg=0.92, torso=0.92, hipw=0.92, shoulderw=0.92, arm=0.95, hand=0.95, foot=0.95),
              dict(chest_w=0.94, chest_d=1.08, belly=0.9, seat=0.94, thigh=0.92, arm_r=0.92)),
    'athletic': (dict(leg=1.06, torso=1.04, hipw=1.0, shoulderw=1.1, arm=1.04, hand=1.04),
                 dict(chest_w=1.1, chest_d=1.05, belly=0.9, seat=1.0, thigh=1.08, shoulder=1.1, arm_r=1.1)),
    # the landlord: short and bulky - a barrel chest and belly on short legs, no neck, big paws
    'boss_bulldog': (dict(leg=0.86, torso=1.02, hipw=1.3, shoulderw=1.45, arm=1.0, hand=1.38, head=1.16, neck=0.55, foot=1.15),
                     dict(chest_w=1.62, chest_d=1.5, belly=1.55, belly_drop=0.06, seat=1.3, thigh=1.42, shoulder=1.6,
                          arm_r=1.55, forearm=1.25, neck_r=1.65, cuff=1.3)),
    # the Sasquatch: the biggest character in the game (~7 ft): huge everywhere, long arms, giant paws
    'boss_bear': (dict(leg=1.42, torso=1.45, hipw=1.38, shoulderw=1.8, arm=1.32, hand=1.7, head=1.42, neck=0.75, foot=1.4),
                  dict(chest_w=1.72, chest_d=1.62, belly=1.35, belly_drop=0.02, seat=1.3, thigh=1.55, shoulder=1.95,
                       arm_r=1.95, forearm=1.35, neck_r=1.8, cuff=1.35)),
    # the boss: bigger, farm-strong (huge shoulders and arms), a short thick neck, big hands and feet
    'boss_ox': (dict(leg=1.2, torso=1.24, hipw=1.24, shoulderw=1.68, arm=1.16, hand=1.5, head=1.1, neck=0.7, foot=1.25),
                dict(chest_w=1.72, chest_d=1.5, belly=1.1, belly_drop=0.0, seat=1.16, thigh=1.45, shoulder=2.0,
                     arm_r=1.9, forearm=1.55, neck_r=1.7, cuff=1.3)),
}

# ------------------------------------------------------------------------------------------- species registry
# Every heads/<species>.py declares a literal SPECIES dict: family, tail type, default build (a BUILDS name),
# build_over / body_over tweaks and fixed colours. Read with ast (no import, no Blender needed), so a new species is
# one new file and nobody edits a shared table.
HEADS_DIR = os.path.join(HERE, 'heads')
_SPECIES = None


def _read_species(path):
    import ast
    tree = ast.parse(open(path).read(), path)
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'SPECIES' for t in node.targets):
            d = ast.literal_eval(node.value)
            for k in ('family', 'tail', 'build'):
                if k not in d:
                    raise ValueError('%s: SPECIES needs %r' % (path, k))
            if d['build'] not in BUILDS:
                raise ValueError('%s: unknown build %r (cspecs.BUILDS)' % (path, d['build']))
            return d
    return None


def species_registry(refresh=False):
    """{species: entry} for every heads/<species>.py with a SPECIES literal."""
    global _SPECIES
    if _SPECIES is None or refresh:
        reg = {}
        for f in sorted(os.listdir(HEADS_DIR)):
            if not f.endswith('.py') or f.startswith(('_', 'fam_')):
                continue
            d = _read_species(os.path.join(HEADS_DIR, f))
            if d is not None:
                reg[f[:-3]] = d
        _SPECIES = reg
    return _SPECIES


class _SpeciesView(dict):
    """SPECIES[name] -> the registry entry (kept for older callers)."""
    def __getitem__(self, k):
        return species_registry()[k]

    def get(self, k, d=None):
        return species_registry().get(k, d)

    def __contains__(self, k):
        return k in species_registry()


SPECIES = _SpeciesView()

# team uniform colours (preview; the runtime recolours team_a / team_b / cap / cap_brim / decal_*)
INKSET_UNIFORM = {'classic': dict(team_a='#2E5AAC', team_b='#D9483B')}


def _hex(rgb):
    return '#%02X%02X%02X' % tuple(int(round(max(0, min(1, c)) * 255)) for c in rgb)


def _rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def shade(h, dl=0.0, ds=0.0):
    r, g, b = _rgb(h)
    hh, l, s = colorsys.rgb_to_hls(r, g, b)
    return _hex(colorsys.hls_to_rgb(hh, max(0, min(1, l + dl)), max(0, min(1, s + ds))))


def mix(a, b, t):
    ra, rb = _rgb(a), _rgb(b)
    return _hex(tuple(x + (y - x) * t for x, y in zip(ra, rb)))


def lum(h):
    r, g, b = _rgb(h)
    return 0.3 * r + 0.59 * g + 0.11 * b


def team_colors(team_idx):
    """Preview uniform colours from the team's ink set (BB.INKSETS: a = jersey / cap, b = trims); the runtime applies
    the real team colours by material name."""
    t = TEAMS[team_idx] if team_idx is not None and 0 <= team_idx < len(TEAMS) else None
    ink = DATA.get('inksets', {}).get((t or {}).get('inkset', 'classic')) or {}
    a = ink.get('a', INKSET_UNIFORM['classic']['team_a'])
    b = ink.get('b', INKSET_UNIFORM['classic']['team_b'])
    return dict(team_a=a, team_b=b, cap=a, cap_brim=a, decal_chest=a, decal_back=a)


def palette_colors(species, pal, seed=0):
    """Fur colours from the card palette [main, secondary, accent]: fur / fur_light / fur_dark (darker of accent and a
    shaded main, so brows and ears always read), birds get feather / feather_accent."""
    main, sec, acc = pal
    rng = np.random.default_rng(seed & 0xFFFFFFFF)
    jitter = rng.uniform(-0.025, 0.025)          # card mates of one species are never exactly the same colour
    main = shade(main, jitter)
    # fur / fur_light / fur_dark = the card's main / secondary / accent; mask = the dark ink-brown of brows and grease
    c = dict(fur=main, fur_light=sec, fur_dark=acc, mask=mix(main, INK, 0.72))
    fam = SPECIES.get(species, {}).get('family', 'mammal')
    if fam == 'bird':
        c.update(feather=main, feather_accent=acc if abs(lum(acc) - lum(main)) > 0.08 else shade(main, -0.2))
    return c


# ------------------------------------------------------------------------------------------- characters
def base_spec(id_, species, role, name, number, seed, face, team_idx, build=None):
    if species not in species_registry():
        raise MissingSpecies(species)
    sp = species_registry()[species]
    bname = build or sp['build']
    b, bp = BUILDS[bname]
    b = dict(b)
    b.update(sp.get('build_over', {}))
    colors = dict(MATERIAL_DEFAULTS)
    colors.update(team_colors(team_idx))
    colors.update(sp.get('colors', {}))
    colors.update(palette_colors(species, face['pal'], seed))
    hands = {'pitcher': ('bare', 'mitt'), 'fielder': ('bare', 'mitt'), 'catcher': ('bare', 'catcher'),
             'runner': ('glove', 'glove'), 'umpire': ('bare', 'bare')}[role]
    body = dict(bp)
    body.update(sp.get('body_over', {}))
    return dict(id=id_, name=name, species=species, family=sp['family'], role=role, number=number, seed=seed,
                face=face, colors=colors, build=b, body=body, build_name=bname, head={}, accessories={},
                tail=sp['tail'], hands=hands, gear=[], boss=False, team=team_idx)


MATERIAL_DEFAULTS = dict(mouth='#5A1F2A', tongue='#E0605A', teeth='#FFFFFF', eye_white='#FFFFFF', pupil=INK,
                         uniform='#FFF6E6', belt='#3B2F2A', sock='#FFFFFF', shoe='#1E1A22', sole='#4A3F3A',
                         lace='#FFFFFF', glove='#FFFFFF', mitt='#B8692E', mitt_lace='#6E3A1C', mask='#2E2A38',
                         accessory_a='#F59AB8', accessory_b='#2E2A38')


def accessory_colors(s):
    acc = dict((s.get('face') or {}).get('acc') or {})
    acc.update(s.get('accessories') or {})
    if acc.get('bandaid'):
        s['colors']['accessory_a'] = '#EAC79C'
    if acc.get('stalk'):
        s['colors']['accessory_a'] = '#E8C25A'
    if acc.get('gum'):
        s['colors']['accessory_a'] = '#F59AB8'
    return s


def card_spec(cid, **over):
    c = CARDS[cid]
    role = {'P': 'pitcher', 'C': 'catcher'}.get(c['pos'], 'fielder')
    s = base_spec(cid, c['species'], role, c['name'], c['number'], c['seed'], c['face'], c['teamIdx'])
    s['pos'] = c['pos']
    return _apply(accessory_colors(s), over)


def pitcher_spec(pid, **over):
    p = PITCHERS[pid]
    look = p.get('look') or {}
    build = {'stout': 'stout', 'lanky': 'lanky', 'tall': 'tall'}.get(look.get('build'), None)
    team_idx = next((i for i, t in enumerate(TEAMS) if t['mascot'] == p.get('team')), 0)
    s = base_spec(pid, p['species'], 'pitcher', p['name'], look.get('number', 0), p['seed'], p['face'], team_idx, build)
    s['boss'] = bool(p.get('boss'))
    s['throws'] = p.get('hand', 'R')            # left-handers are mirrored at runtime (models are all right-handed)
    s['windup'] = look.get('windup', 'classic')
    s['nick'] = p.get('nick')
    hair = look.get('hair')
    if hair and hair != 'none':
        s['accessories']['hair'] = hair
    return _apply(accessory_colors(s), over)


def _apply(s, over):
    over = dict(over)
    bn = over.pop('build_name', None)
    if bn:
        b, bp = BUILDS[bn]
        s['build'] = dict(b)
        s['build'].update(SPECIES[s['species']].get('build_over', {}))
        s['body'] = dict(bp)
        s['body'].update(SPECIES[s['species']].get('body_over', {}))
        s['build_name'] = bn
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(s.get(k), dict):
            s[k] = dict(s[k])
            s[k].update(v)
        else:
            s[k] = v
    return s


class MissingSpecies(KeyError):
    pass


def add(S, pending, cid, make):
    """S[cid] = make(), or note the character as pending when its species module does not exist yet (a park can
    list its whole roster while its species heads are still being written)."""
    try:
        S[cid] = make()
    except MissingSpecies as e:
        pending[cid] = e.args[0] if e.args else 'missing species'


_SPECS = None


def specs(refresh=False):
    """Every character the generator knows: {id: spec} from specs/*.py (park1 ... park6, extras, tests)."""
    global _SPECS
    if _SPECS is None or refresh:
        import specs as SP
        _SPECS = SP.discover()
    return _SPECS


def default_lods(spec):
    """Contract: pitchers, catchers and the umpire ship LOD0 + LOD1; fielders and runners LOD1 only."""
    if 'lods' in spec:
        return tuple(spec['lods'])
    return (0, 1) if spec['role'] in ('pitcher', 'catcher', 'umpire') else (1,)


def park_ids(park):
    return [cid for cid, s in specs().items() if s.get('park') == park]


def umpire_spec():
    face = dict(pal=['#4A4048', '#8A7E86', '#2A2228'], acc={'glasses': 1}, cap='fwd')
    s = base_spec('ump', 'mole', 'umpire', 'The Umpire', 0, 4242, face, None)
    s['gear'] = ['umpire']
    s['body'].update(trousers=True, shirt_mat='uniform', pants_mat='accessory_a', arm_mat='uniform', decals=False)
    s['colors'].update(uniform='#2E3B5E', accessory_a='#5C5F6E', accessory_b='#17151C', belt='#17151C', shoe='#17151C',
                       sole='#2A2630', fur='#4A4048', fur_light='#7A6E78', fur_dark='#2A2228', mask='#1E181E')
    s['cap_mats'] = ('accessory_b', 'accessory_b', 'accessory_b')
    s['cap_letter'] = False
    s['body']['hand_mat'] = 'skin'
    s['body']['tail_len'] = 0.45
    s['body']['tail_mat'] = 'fur'
    return s


def mate_spec(species, number, extra):
    sp = DATA['species'].get(species, {})
    pal = (sp.get('pal') or [['#8A5A3A', '#E2C2A0', '#4A2E20']])[0]
    face = dict(pal=pal, acc={}, cap='fwd')
    s = base_spec('mate_' + species, species, 'runner', 'Rocco\'s teammate (%s)' % species, number,
                  {'otter': 1101, 'fox': 2202, 'beaver': 3303}[species], face, 0)
    return _apply(s, extra)


def get(cid):
    return copy.deepcopy(specs()[cid])


class _Lods(dict):
    def get(self, cid, d=None):
        s = specs().get(cid)
        return default_lods(s) if s else d

    def __getitem__(self, cid):
        return default_lods(specs()[cid])


LODS = _Lods()
PARK1 = None          # use park_ids(1)


# ------------------------------------------------------------------------------------------- roster (for the QA tools)
def roster(park):
    """A park's cast for tools/cast-shots.js: pitchers, the catcher and the fielders by position, team preview colours."""
    S = specs()
    ids = park_ids(park)
    out = dict(park=park, pitchers=[], catcher=None, fielders={}, others=[], team=None, windup={}, throws={})
    for cid in ids:
        s = S[cid]
        if s['role'] == 'pitcher':
            out['pitchers'].append(cid)
            out['windup'][cid] = s.get('windup', 'classic')
            out['throws'][cid] = s.get('throws', 'R')
        elif s['role'] == 'catcher':
            out['catcher'] = cid
        elif s['role'] == 'fielder' and s.get('pos'):
            out['fielders'][s['pos']] = cid
        else:
            out['others'].append(cid)
        if out['team'] is None and s.get('team') is not None:
            t = TEAMS[s['team']]
            tc = team_colors(s['team'])
            out['team'] = dict(team_a=tc['team_a'], team_b=tc['team_b'], cap=tc['cap'], cap_brim=tc['cap_brim'],
                               letter=t['short'][0], letterColor=tc['team_a'], name=t['name'])
    out['pitchers'].sort(key=lambda k: (S[k].get('boss', False), k))       # the boss last
    return out


if __name__ == '__main__':
    import sys
    a = sys.argv[1:]
    if a[:1] == ['--roster']:
        print(json.dumps(roster(int(a[1]))))
    else:
        for cid, s in sorted(specs().items(), key=lambda kv: (kv[1].get('park', 0), kv[0])):
            print(cid, s.get('park'), s['species'], s['role'], default_lods(s))
