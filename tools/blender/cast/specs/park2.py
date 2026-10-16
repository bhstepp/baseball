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
    # ---- the possums first (the park-5 agent reuses the possum head)
    add('c2-05', lambda: C.card_spec('c2-05', head=dict(snout=1.0, ears=1.0, patches='small', scruff=True), build_name='tall'))
    add('c2-09', lambda: C.card_spec('c2-09', head=dict(snout=0.9, ears=1.15, droop=0.35, patches='big', scruff=False),
                                     build_name='round'))
    add('c2-10', lambda: C.card_spec('c2-10', head=dict(snout=1.18, ears=0.9, patches='none', scruff=True), build_name='lanky',
                                     colors=dict(fur='#C9C5CC')))
    add('c2-11', lambda: C.card_spec('c2-11', head=dict(snout=1.05, ears=1.05, droop=0.15, patches='big', scruff=True),
                                     build_name='stocky', colors=dict(fur='#6E6A76')))
    return S
