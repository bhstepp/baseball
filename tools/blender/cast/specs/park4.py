# Park 4 - Gull Point Harbor: the Gull Point Gulls. Pitchers Pearl 'Foghorn' Marlowe (walrus), Nils 'Barnacle'
# Brightwater (pelican, lefty), Sully 'Low Tide' Tidewell (seal, submarine) and the boss Winifred 'The Admiral' Gale
# (gull); the card catcher (otter) and fielders by position (c4-04 ... c4-11): 1B gull, 2B walrus, SS walrus,
# 3B puffin, LF otter, CF seal, RF gull. Look-alike species get their own builds, beaks, tusks and markings.
import cspecs as C

PARK = 4
PENDING = {}

GULL = dict(feather_accent='#8E98A8')                 # grey wing-tips on the fan tail (not the card's yellow accent)

# the Admiral: tall, a proud barrel chest, broad shoulders, big hands (cspecs.BUILDS style, on top of 'tall')
ADMIRAL_BUILD = dict(leg=1.20, torso=1.20, hipw=1.08, shoulderw=1.32, arm=1.12, hand=1.20, head=1.16, neck=0.92, foot=1.20)
ADMIRAL_BODY = dict(chest_w=1.40, chest_d=1.45, belly=1.0, belly_drop=0.0, seat=1.04, thigh=1.12, shoulder=1.40,
                    arm_r=1.24, forearm=1.20, neck_r=1.08, cuff=1.06, tail_size=1.3)


def characters():
    S = {}
    add = lambda cid, make: C.add(S, PENDING, cid, make)
    # ---- pitchers
    add('p_pearl', lambda: C.pitcher_spec('p_pearl', head=dict(lady=True, tusks=0.9, stache=1.0),
                                          colors=dict(accessory_a='#F6EEDC')))
    add('p_nils', lambda: C.pitcher_spec('p_nils', head=dict(barnacles=3), build=dict(neck=1.2),
                                         colors=dict(feather_accent='#F2D27A', skin='#F7B77A', horn='#E4DED0')))
    add('p_sully', lambda: C.pitcher_spec('p_sully', head=dict(droopy=True), build=dict(arm=1.16, hand=1.08),
                                          accessories=dict(hair_mat='fur_dark')))
    add('p_admiral', lambda: C.pitcher_spec('p_admiral', build_name='tall', build=ADMIRAL_BUILD, body=ADMIRAL_BODY,
                                            head=dict(boss=True, epaulettes=dict(build=ADMIRAL_BUILD, body=ADMIRAL_BODY)),
                                            accessories=dict(eyeblack=0),
                                            colors=dict(GULL, accessory_a='#E8B43A', fur_light='#A9B3C1')))
    # ---- the card catcher (LOD0 + LOD1) and fielders (LOD1)
    add('c4-04', lambda: C.card_spec('c4-04', gear=['catcher'], cap_back=True, build_name='stocky'))
    add('c4-05', lambda: C.card_spec('c4-05', head=dict(beak=0.88, crown=1.04), build_name='round', colors=dict(GULL)))
    add('c4-06', lambda: C.card_spec('c4-06', head=dict(tusks=0.75, broken=True, stache=1.15), build_name='stocky'))
    add('c4-07', lambda: C.card_spec('c4-07', head=dict(tusks=1.15, stache=0.8), build_name='athletic',
                                     colors=dict(fur='#A88068')))
    add('c4-08', lambda: C.card_spec('c4-08', build_name='stocky', colors=dict(feather_accent='#4A4656')))
    add('c4-09', lambda: C.card_spec('c4-09', build_name='athletic', colors=dict(fur='#7A4E32')))
    add('c4-10', lambda: C.card_spec('c4-10', head=dict(spots=True), build_name='lanky'))
    add('c4-11', lambda: C.card_spec('c4-11', head=dict(beak=1.1, hood=0.5, tufts=True), build_name='lanky',
                                     colors=dict(GULL)))
    return S
