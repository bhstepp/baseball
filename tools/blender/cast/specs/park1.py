# Park 1 - Haybale Grounds: the Haybale Junction Hayseeds (pitchers hank goat, dottie hen, clem dog and the boss
# Earl 'The Ox' Oxley; the card catcher and fielders by position, BB.Meta.CARDS c1-04 ... c1-11).
import cspecs as C

PARK = 1


def characters():
    S = {}
    # ---- pitchers (BB.Content; look.build / look.hair / number from the pitcher table)
    S['p_hank'] = C.pitcher_spec('p_hank', head=dict(horns='swept', horn_len=1.0, beard=0.42, ears_droop=0.35, age=1),
                                 accessories=dict(hair='mustache', hair_mat='fur_dark'),
                                 colors=dict(fur_dark='#9A9286', horn='#CDBF9F'))
    S['p_dottie'] = C.pitcher_spec('p_dottie', head=dict(comb='hen'), tail='fan')
    S['p_clem'] = C.pitcher_spec('p_clem', head=dict(snout=1.08), accessories=dict(hair='sideburns', hair_mat='fur_dark'))
    # the boss: bigger, farm-strong, a mean resting glare, brass nose ring, beard
    S['p_ox'] = C.pitcher_spec('p_ox', build_name='boss_ox', head=dict(horns='ox_boss', mean=1.0, tuft=True, boss=True),
                               accessories=dict(hair='beard', hair_mat='fur_dark', nose_ring=1),
                               colors=dict(accessory_b='#D9A441', fur_dark='#5E3418', mask='#2E1A10'))
    # ---- the card catcher (LOD0 + LOD1) and fielders (LOD1)
    S['c1-04'] = C.card_spec('c1-04', gear=['catcher'], head=dict(marking='patch'), build_name='stocky', cap_back=True,
                             colors=dict(accessory_a='#C9A27A'))
    S['c1-05'] = C.card_spec('c1-05', head=dict(mane=True, blaze=True))
    S['c1-06'] = C.card_spec('c1-06', head=dict(comb='rooster'))
    S['c1-07'] = C.card_spec('c1-07', head=dict(horns='ox', tuft=True), build_name='athletic')
    S['c1-08'] = C.card_spec('c1-08', head=dict(wool=True))
    # the two goats must not look alike: long scimitar horns + lanky (LF) vs short spikes + stocky, greyer (RF)
    S['c1-09'] = C.card_spec('c1-09', head=dict(horns='scimitar', horn_len=1.15, beard=0.40, ears_droop=0.1))
    S['c1-10'] = C.card_spec('c1-10', head=dict(horns='nub', spots=True))
    S['c1-11'] = C.card_spec('c1-11', head=dict(horns='spike', horn_len=0.8, beard=0.22, ears_droop=0.45),
                             build_name='stocky', colors=dict(fur='#E9E2D2', horn='#B9A27E'))
    return S
