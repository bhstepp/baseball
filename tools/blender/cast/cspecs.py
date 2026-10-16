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
    # the boss: bigger, farm-strong (huge shoulders and arms), a short thick neck, big hands and feet
    'boss_ox': (dict(leg=1.2, torso=1.24, hipw=1.24, shoulderw=1.68, arm=1.16, hand=1.5, head=1.1, neck=0.7, foot=1.25),
                dict(chest_w=1.72, chest_d=1.5, belly=1.1, belly_drop=0.0, seat=1.16, thigh=1.45, shoulder=2.0,
                     arm_r=1.9, forearm=1.55, neck_r=1.7, cuff=1.3)),
}

# ------------------------------------------------------------------------------------------- species defaults
SPECIES = {
    'dog': dict(family='mammal', tail='dog', build='average', colors={'nose': INK}),
    'goat': dict(family='mammal', tail='stub', build='lanky', colors={'nose': '#E8A9A0', 'horn': '#D9CBB0', 'skin': '#F0B4AC'}),
    'ox': dict(family='mammal', tail='tufted', build='stocky', colors={'horn': '#F2E8D2', 'nose': '#3A2620'},
               body_over=dict(tail_tip_mat='fur_dark')),
    'cow': dict(family='mammal', tail='tufted', build='stout', colors={'horn': '#F2E8D2', 'nose': '#E8A9A0', 'skin': '#F2B4B0'},
                body_over=dict(tail_tip_mat='fur_dark')),
    'horse': dict(family='mammal', tail='hair', build='tall', build_over=dict(neck=1.35), colors={'nose': '#3A2620', 'skin': '#F4ECE0'},
                  body_over=dict(tail_mat='fur_dark')),
    'sheep': dict(family='mammal', tail='stub', build='round', colors={'nose': '#E8A9A0', 'skin': '#F2D8CC'}),
    'mole': dict(family='mammal', tail='thin', build='round', colors={'nose': '#F29AA6', 'skin': '#F2B4B4'},
                 body_over=dict(hand_mat='skin', tail_mat='skin')),
    'otter': dict(family='mammal', tail='thick', build='average', build_over=dict(leg=0.9, torso=1.08), colors={'nose': INK}),
    'fox': dict(family='mammal', tail='bushy', build='lanky', colors={'nose': INK}, body_over=dict(tail_tip_mat='fur_light')),
    'beaver': dict(family='mammal', tail='flat', build='round', colors={'nose': INK, 'skin': '#5A4A44', 'teeth': '#F6E7B8'},
                   body_over=dict(tail_mat='skin')),
    'lizard': dict(family='reptile', tail='lizard', build='lanky', colors={'skin': '#7DB04E', 'fur_light': '#EBDFA0', 'mask': '#2F4A2A'},
                   body_over=dict(hand_mat='skin', tail_mat='skin', tail_tip_mat='mask')),
    'moose': dict(family='mammal', tail='stub', build='tall', colors={'horn': '#E8D2A8', 'nose': '#3A2620'}),
    'walrus': dict(family='mammal', tail='none', build='round', colors={'nose': INK, 'teeth': '#F6EED8'}),
    'tortoise': dict(family='reptile', tail='lizard', build='round', colors={'shell': '#8DAA5E', 'fur_dark': '#5E6E3A'},
                     body_over=dict(hand_mat='skin', tail_mat='skin', tail_len=0.4)),
    'hen': dict(family='bird', tail='fan', build='lanky', colors={'beak': '#F2B632', 'skin': '#D9483B'},
                body_over=dict(hand_mat='feather', tail_mat='feather', tail_tip_mat='feather_accent')),
    'rooster': dict(family='bird', tail='fan', build='small', colors={'beak': '#F2B632', 'skin': '#D9483B'},
                    body_over=dict(hand_mat='feather', tail_mat='feather', tail_tip_mat='feather_accent')),
}

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
    t = TEAMS[team_idx] if team_idx is not None else None
    u = INKSET_UNIFORM.get((t or {}).get('inkset', 'classic'), INKSET_UNIFORM['classic'])
    a, b = u['team_a'], u['team_b']
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
    sp = SPECIES[species]
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
    s['throws'] = p.get('hand', 'R')
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


def specs():
    """Every character the generator knows (park 1 + the umpire + Rocco's teammates)."""
    S = {}
    # ---- Haybale Junction Hayseeds pitchers
    S['p_hank'] = pitcher_spec('p_hank', head=dict(horns='swept', horn_len=1.0, beard=0.42, ears_droop=0.35, age=1),
                               accessories=dict(hair='mustache', hair_mat='fur_dark'),
                               colors=dict(fur_dark='#9A9286', horn='#CDBF9F'))
    S['p_dottie'] = pitcher_spec('p_dottie', head=dict(comb='hen'), tail='fan')
    S['p_clem'] = pitcher_spec('p_clem', head=dict(snout=1.08), accessories=dict(hair='sideburns', hair_mat='fur_dark'))
    S['p_ox'] = pitcher_spec('p_ox', build_name='boss_ox', head=dict(horns='ox_boss', mean=1.0, tuft=True, boss=True),
                             accessories=dict(hair='beard', hair_mat='fur_dark', nose_ring=1),
                             colors=dict(accessory_b='#D9A441', fur_dark='#5E3418', mask='#2E1A10'))
    # ---- the card catcher and fielders (LOD1; the catcher LOD0 too)
    S['c1-04'] = card_spec('c1-04', gear=['catcher'], head=dict(marking='patch'), build_name='stocky', cap_back=True,
                           colors=dict(accessory_a='#C9A27A'))
    S['c1-05'] = card_spec('c1-05', head=dict(mane=True, blaze=True))
    S['c1-06'] = card_spec('c1-06', head=dict(comb='rooster'))
    S['c1-07'] = card_spec('c1-07', head=dict(horns='ox', tuft=True), build_name='athletic')
    S['c1-08'] = card_spec('c1-08', head=dict(wool=True))
    S['c1-09'] = card_spec('c1-09', head=dict(horns='scimitar', horn_len=1.15, beard=0.40, ears_droop=0.1))
    S['c1-10'] = card_spec('c1-10', head=dict(horns='nub', spots=True))
    S['c1-11'] = card_spec('c1-11', head=dict(horns='spike', horn_len=0.8, beard=0.22, ears_droop=0.45),
                           build_name='stocky', colors=dict(fur='#E9E2D2', horn='#B9A27E'))
    # ---- the umpire (a mole) and Rocco's teammates (runners)
    S['ump'] = umpire_spec()
    for sp, num, extra in (('otter', 8, {}), ('fox', 3, {}), ('beaver', 14, {})):
        S['mate_' + sp] = mate_spec(sp, num, extra)
    return S


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


def test_specs():
    """Head-kit test characters (not shipped): one per family not covered by park 1."""
    S = {}
    face = dict(pal=['#7DB04E', '#EBDFA0', '#2F4A2A'], acc={}, cap='fwd')
    s = base_spec('test_lizard', 'lizard', 'fielder', 'Test Lizard', 7, 777, face, 4)
    s['colors'].update(skin='#7DB04E', fur_light='#EBDFA0', mask='#2F4A2A')
    S['test_lizard'] = s
    for sp, num in (('moose', 38), ('walrus', 11), ('tortoise', 3)):
        pal = (DATA['species'].get(sp, {}).get('pal') or [['#8A5A3A', '#D9B49A', '#4A2E20']])[0]
        t = base_spec('test_' + sp, sp, 'pitcher', 'Test ' + sp, num, 900 + num, dict(pal=pal, acc={}, cap='fwd'), 2)
        if sp == 'tortoise':
            t['gear'] = ['shell']
            t['colors'].update(skin=pal[0], fur_light=pal[1])
        S['test_' + sp] = t
    return S


def get(cid):
    allspecs = specs()
    allspecs.update(test_specs())
    return copy.deepcopy(allspecs[cid])


PARK1 = ['p_hank', 'p_dottie', 'p_clem', 'p_ox', 'c1-04', 'c1-05', 'c1-06', 'c1-07', 'c1-08', 'c1-09', 'c1-10', 'c1-11',
         'ump', 'mate_otter', 'mate_fox', 'mate_beaver']
# which LODs each character ships (contract: fielders and runners LOD1 only)
LODS = {cid: ((0, 1) if (cid.startswith('p_') or cid in ('c1-04', 'ump')) else (1,)) for cid in PARK1}
