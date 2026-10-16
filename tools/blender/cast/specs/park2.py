# Park 2 - Rivet Street Bandbox (city): the Ironbridge Rivets. Pitchers vinnie rat ("Two-Bit", sidearm), rosalind
# pigeon ("Rooftop", lefty high kick), marty cat ("Subway", submarine) and the boss Lou "The Landlord" Brodsky,
# bulldog; the card catcher (bulldog) and fielders by position (c2-04 ... c2-11): 1B possum, 2B cat, SS rat,
# 3B bulldog, LF / CF / RF possums - four possums, each with its own face and build.
import cspecs as C

PARK = 2
PENDING = {}


def characters():
    S = {}
    add = lambda cid, make: C.add(S, PENDING, cid, make)
    # ---- pitchers
    add('p_vinnie', lambda: C.pitcher_spec('p_vinnie', head=dict(ears=1.08, snout=1.06),
                                           accessories=dict(hair='mustache', hair_mat='mask')))
    add('p_rosalind', lambda: C.pitcher_spec('p_rosalind'))
    add('p_marty', lambda: C.pitcher_spec('p_marty', head=dict(coat='tabby'), accessories=dict(hair='sideburns', hair_mat='fur_dark')))
    # the boss: unmistakably the landlord - short and bulky, heavy jowls, an underbite, a mean squint, a mustache, a
    # toothpick and a big ring of keys on his belt (no eye black / freckles from the card portrait)
    add('p_landlord', lambda: C.pitcher_spec('p_landlord', build_name='boss_bulldog', gear=['keys'],
                                             head=dict(jowls=1.5, mean=1.0, fangs=True, ear_dark=True),
                                             accessories=dict(hair='mustache', hair_mat='fur_dark', toothpick=1, eyeblack=0, freckles=0),
                                             colors=dict(accessory_a='#D9B87A', accessory_b='#A8A8B0', fur_dark='#8A6A50', mask='#3A2A20')))
    # ---- the card catcher (LOD0 + LOD1) and fielders (LOD1)
    add('c2-04', lambda: C.card_spec('c2-04', gear=['catcher'], cap_back=True, build_name='stocky', head=dict(jowls=1.2),
                                     colors=dict(accessory_a='#C9A27A')))
    add('c2-05', lambda: C.card_spec('c2-05', head=dict(snout=1.0, ears=1.0, patches='small', scruff=True), build_name='tall'))
    add('c2-06', lambda: C.card_spec('c2-06', head=dict(coat='tuxedo', ears=1.1), build_name='athletic'))
    add('c2-07', lambda: C.card_spec('c2-07', head=dict(ears=0.95, snout=1.0), build_name='small'))
    add('c2-08', lambda: C.card_spec('c2-08', head=dict(jowls=1.0, ear_dark=True), build_name='stout'))
    # the outfield possums: round + big patches + droopy ears / lanky + pale coat, no patches / stocky + dark coat
    add('c2-09', lambda: C.card_spec('c2-09', head=dict(snout=0.9, ears=1.15, droop=0.35, patches='big', scruff=False),
                                     build_name='round'))
    add('c2-10', lambda: C.card_spec('c2-10', head=dict(snout=1.18, ears=0.9, patches='none', scruff=True), build_name='lanky',
                                     colors=dict(fur='#C9C5CC')))
    add('c2-11', lambda: C.card_spec('c2-11', head=dict(snout=1.05, ears=1.05, droop=0.15, patches='big', scruff=True),
                                     build_name='stocky', colors=dict(fur='#6E6A76')))
    return S
