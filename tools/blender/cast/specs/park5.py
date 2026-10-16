# Park 5 - Saguaro Night Field: the Dry Wash Coyotes. Pitchers Rio 'Dust Devil' Calloway (armadillo, sidearm),
# Tess 'Tumbleweed' Rattigan (tortoise, lefty eephus), Cosmo 'Night Owl' Starling (possum, high kick) and the boss
# Dez 'The Mirage' Montoya (chameleon, lefty sidearm); the card catcher (fennec) and fielders by position
# (c5-04 ... c5-11): 1B badger, 2B lizard, SS armadillo, 3B badger, LF lizard, CF armadillo, RF tortoise.
# Also Bobby Lobbs, 'Batting Practice Bob' (badger, the endless-derby pitcher, park 0: built with the extras):
# listed here unless specs/extras.py lists him too (two modules must never define the same id); heads/badger.py
# gives him his goofy look either way.
import cspecs as C

PARK = 5
PENDING = {}

MIRAGE_BUILD = dict(leg=1.30, torso=1.18, hipw=1.0, shoulderw=1.18, arm=1.24, hand=1.22, head=1.24, neck=1.08, foot=1.20)
MIRAGE_BODY = dict(chest_w=1.06, chest_d=1.0, belly=0.86, seat=0.94, thigh=0.96, shoulder=1.12, arm_r=1.0, neck_r=0.98,
                   cuff=0.96, tail_len=1.35, tail_size=1.3)
BOB_BODY = dict(belly=1.55, belly_drop=0.06, seat=1.18, chest_d=1.18)


def _taken_by_extras(cid):
    try:
        import importlib
        return cid in importlib.import_module('specs.extras').characters()
    except Exception:           # noqa: BLE001 - no extras module: nobody else lists him
        return False


def characters():
    S = {}
    add = lambda cid, make: C.add(S, PENDING, cid, make)
    shell = dict(gear=['shell'])
    # ---- pitchers
    add('p_rio', lambda: C.pitcher_spec('p_rio', head=dict(ears=1.08, tilt=0.12, snout=1.05), **shell))
    add('p_tess', lambda: C.pitcher_spec('p_tess', head=dict(old=True), accessories=dict(stalk=1),
                                         colors=dict(accessory_a='#E8C25A'), **shell))
    add('p_cosmo', lambda: C.pitcher_spec('p_cosmo', head=dict(snout=1.12, ears=1.18, droop=0.05, patches='big', scruff=True),
                                          colors=dict(fur='#7C7886')))
    add('p_mirage', lambda: C.pitcher_spec('p_mirage', build_name='lanky', build=MIRAGE_BUILD, body=MIRAGE_BODY,
                                           head=dict(chameleon=True, coil=dict(build=MIRAGE_BUILD, body=MIRAGE_BODY)),
                                           colors=dict(fur_light='#F6D2A0', accessory_a='#E8B84A')))
    # ---- the card catcher (LOD0 + LOD1) and fielders (LOD1)
    add('c5-04', lambda: C.card_spec('c5-04', gear=['catcher'], cap_back=True, build_name='stocky', head=dict(ears=0.95),
                                     colors=dict(accessory_a='#C9A27A')))
    add('c5-05', lambda: C.card_spec('c5-05', head=dict(smudge=True), build_name='stocky'))
    add('c5-06', lambda: C.card_spec('c5-06', head=dict(blotches=6), build_name='stout'))
    add('c5-07', lambda: C.card_spec('c5-07', head=dict(ears=0.95, tilt=0.05), build_name='athletic', **shell))
    add('c5-08', lambda: C.card_spec('c5-08', head=dict(snout=1.12, jowls=1.1), build_name='round'))
    add('c5-09', lambda: C.card_spec('c5-09', head=dict(specs=True, crest=True, blotches=8), build_name='lanky'))
    add('c5-10', lambda: C.card_spec('c5-10', head=dict(ears=1.2, tilt=0.18, snout=1.12, plates=5), build_name='lanky', **shell))
    add('c5-11', lambda: C.card_spec('c5-11', build_name='stocky', **shell))
    # ---- Batting Practice Bob (derby pitcher)
    if not _taken_by_extras('p_bpbob'):
        add('p_bpbob', lambda: dict(C.pitcher_spec('p_bpbob', build_name='round', body=BOB_BODY, head=dict(goofy=True),
                                                         accessories=dict(hair_mat='fur')), park=0))
    return S
