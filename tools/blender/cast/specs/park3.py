# Park 3 - Loon Lake Pines: the Loon Lake Loons. Pitchers ellis moose ("Woodsmoke"), june loon ("The Loon", lefty
# knuckleballer), otis beaver ("Canoe", sidearm) and the boss Gus "Sasquatch" Haldane, bear - the biggest character
# in the game, shaggy, a tiny cap perched on a giant head; the card catcher (deer) and fielders by position
# (c3-04 ... c3-11): 1B squirrel, 2B moose, SS bear, 3B beaver, LF squirrel, CF deer, RF skunk.
import cspecs as C

PARK = 3
PENDING = {}


def characters():
    S = {}
    add = lambda cid, make: C.add(S, PENDING, cid, make)
    # ---- pitchers
    add('p_ellis', lambda: C.pitcher_spec('p_ellis', head=dict(antlers=1.1), accessories=dict(hair='beard', hair_mat='fur_dark')))
    add('p_june', lambda: C.pitcher_spec('p_june', colors=dict(feather_accent='#4A5060')))
    add('p_otis', lambda: C.pitcher_spec('p_otis', accessories=dict(hair='sideburns', hair_mat='fur_dark')))
    add('p_sasquatch', lambda: C.pitcher_spec('p_sasquatch', build_name='boss_bear', gear=['shag'],
                                              head=dict(shaggy=True, small_cap=True, mean=0.6),
                                              accessories=dict(hair='beard', hair_mat='fur_dark', eyeblack=0),
                                              colors=dict(mask='#2A1810')))
    # ---- the card catcher (LOD0 + LOD1) and fielders (LOD1)
    add('c3-04', lambda: C.card_spec('c3-04', gear=['catcher'], cap_back=True, build_name='stocky', colors=dict(accessory_a='#C9A27A')))
    add('c3-05', lambda: C.card_spec('c3-05', build_name='small'))
    add('c3-06', lambda: C.card_spec('c3-06', head=dict(antlers=0.85), build_name='tall'))
    add('c3-07', lambda: C.card_spec('c3-07', build_name='athletic'))
    add('c3-08', lambda: C.card_spec('c3-08', build_name='stocky'))
    add('c3-09', lambda: C.card_spec('c3-09', build_name='lanky'))
    add('c3-10', lambda: C.card_spec('c3-10', build_name='lanky', head=dict(spots=False)))
    add('c3-11', lambda: C.card_spec('c3-11'))
    return S
