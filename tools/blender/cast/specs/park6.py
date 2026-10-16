# Park 6 - Old Cathedral Park: the Capitol City Copperheads, the last stop on the tour - elegant, a bit snooty, very
# fancy. Pitchers Augustus "The Organist" Fairchild (flamingo, waxed mustache and a monocle), Belle "Gargoyle"
# Harrow (a stone-grey stout owl, lefty), Rex "Old Thunder" Underwood (a massive grizzled bison) and the final boss
# Cornelius "Halo" Vane (peacock: crest, smug lids and a fanned train that frames him like a halo); the card catcher
# (parrot, mask-less: chest protector and shin guards hung from the head module, a beak never fits a cage) and the
# fielders by position (c6-05 ... c6-11): 1B heron, 2B owl, SS goose, 3B flamingo, LF parrot, CF goose, RF flamingo.
# Every spec carries head['_k'] = a hash of heads/_park6.py + the body kit the head modules read (cskel, cbody, ctail,
# cgear) + the spec's build / body / tail: the head cache (keyed on the head options) follows them.
import os
import json
import hashlib
import cspecs as C

PARK = 6
PENDING = {}


CAST = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KIT = [os.path.join(CAST, 'heads', '_park6.py')] + [os.path.join(CAST, f) for f in ('cskel.py', 'cbody.py', 'ctail.py', 'cgear.py')] + \
    [os.path.join(os.path.dirname(CAST), 'rk_rig.py')]
_KIT_HASH = None


def kit_hash():
    """Sources the park-6 head modules read besides the head kit (plain file hashing: no Blender needed here)."""
    global _KIT_HASH
    if _KIT_HASH is None:
        h = hashlib.sha1()
        for p in KIT:
            if os.path.exists(p):
                h.update(open(p, 'rb').read())
        _KIT_HASH = h.hexdigest()
    return _KIT_HASH


def frame_key(s):
    h = hashlib.sha1((kit_hash() + json.dumps([s['build'], s['body'], s.get('tail'), s.get('gear')], sort_keys=True,
                                              default=str)).encode())
    return h.hexdigest()[:12]


def keyed(make):
    def f():
        s = make()
        s['head'] = dict(s['head'])
        s['head']['_k'] = frame_key(s)
        return s
    return f


def characters():
    S = {}
    add = lambda cid, make: C.add(S, PENDING, cid, keyed(make))
    # ---- pitchers
    # The Organist: tall and dapper, cap backwards (card), a waxed handlebar and a gold monocle
    add('p_organist', lambda: C.pitcher_spec('p_organist', build=dict(neck=2.15, leg=1.3, torso=1.08),
                                             head=dict(monocle=True, beak=1.04, neck_bow=0.12),
                                             accessories=dict(hair='mustache', hair_mat='fur_dark')))
    # Gargoyle: a squat stone-grey owl with stony horn tufts and unblinking yellow eyes (lefty, cap backwards: card)
    add('p_belle', lambda: C.pitcher_spec('p_belle', head=dict(tufts=1.35, pupil=0.78, iris_scale=2.2, disc=1.05)))
    # Old Thunder: massive and grizzled - huge shoulders and arms on a heavy frame, a short thick neck, the shaggy hump
    add('p_thunder', lambda: C.pitcher_spec('p_thunder', build=dict(leg=1.12, torso=1.22, hipw=1.22, shoulderw=1.62, arm=1.14, hand=1.4,
                                                                   head=1.18, neck=0.6, foot=1.25),
                                            body=dict(chest_w=1.66, chest_d=1.48, belly=1.25, belly_drop=0.02, seat=1.16, thigh=1.38,
                                                      shoulder=1.9, arm_r=1.7, forearm=1.45, neck_r=1.6, cuff=1.25),
                                            head=dict(horn=1.12, mop=1.0, beard=0.62, hump=1.0, grizzle=0.3)))
    # the final boss, Halo: tall and proud - long legs, a puffed-out chest, a long neck; smug heavy lids, a cocked brow,
    # the crest on his cap and the fanned train (the halo) hung on his hips
    add('p_halo', lambda: C.pitcher_spec('p_halo', build=dict(leg=1.2, torso=1.1, hipw=0.95, shoulderw=1.15, arm=1.1, hand=1.12,
                                                             head=1.12, neck=1.5, foot=1.12),
                                         body=dict(chest_w=1.12, chest_d=1.32, belly=0.95, belly_drop=0.0, seat=1.0, thigh=0.95,
                                                   shoulder=1.12, arm_r=1.05, neck_r=0.95, cuff=0.95),
                                         tail='none',
                                         head=dict(lid=17.0, cocked=2.2, smirk=0.5, smile=0.3, crest=1.0, pupil=0.85, skin_tris=3000,
                                                   train=dict(n=13, n_in=9, length=3.0, side=0.8, spread=68, lean=14, eye=0.22,
                                                              rise=0.30, back=0.42))))
    # ---- the card catcher: a parrot, mask-less (chest protector + shin guards from the head module), cap backwards
    add('c6-04', lambda: C.card_spec('c6-04', gear=[], cap_back=True, build_name='stocky', head=dict(beak=1.1, catcher_gear=True, skin_tris=2100),
                                     colors=dict(accessory_b='#2E2A38')))
    # ---- the card fielders: 1B heron (stern, long dagger bill, plumes), 2B owl (brown, small tufts), LF parrot (lanky,
    # a feather topknot out of the back of his cap)
    add('c6-05', lambda: C.card_spec('c6-05', head=dict(stern=True)))
    add('c6-06', lambda: C.card_spec('c6-06', head=dict(tufts=0.8, pupil=1.0, iris_scale=1.8, brow_tilt=-0.02), build_name='average',
                                     build=dict(neck=0.8)))
    add('c6-09', lambda: C.card_spec('c6-09', head=dict(beak=0.92, crest=1.0, brow_tilt=0.03), build_name='lanky'))
    # ---- the two flamingos (3B 'Flapjack': athletic, chunky bill, cowlick; RF 'Skeeter': the
    # skinniest, longest neck, deeper coral)
    add('c6-08', lambda: C.card_spec('c6-08', head=dict(beak=1.12, bend=0.04, tuft=True, lid=4.0, worry=True, neck_bow=0.06),
                                     build_name='athletic', build=dict(neck=1.9, leg=1.18)))
    add('c6-11', lambda: C.card_spec('c6-11', head=dict(beak=0.94, neck_bow=0.14), build_name='lanky',
                                     build=dict(neck=2.45, leg=1.36, hipw=0.8), body=dict(thigh=0.66, chest_w=0.84),
                                     colors=dict(fur='#EE8A8E', feather='#EE8A8E')))
    # ---- the two geese (SS lanky worrier with freckles, CF round old-timer with a bill knob)
    add('c6-07', lambda: C.card_spec('c6-07', head=dict(slim=1.0, beak=0.95, lid=6.0, worry=True, neck_fwd=0.06),
                                     build_name='lanky', build=dict(neck=1.85)))
    add('c6-10', lambda: C.card_spec('c6-10', head=dict(beak=1.12, knob=1.0, lid=9.0, worry=True, dark_cap=True, neck_fwd=0.02),
                                     build_name='round', build=dict(neck=1.45), colors=dict(fur='#8E8A84')))
    return S
