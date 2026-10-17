# Portrait-only characters: the trading cards with no 3D player in the game (each team's three P cards and the DH,
# BB.Meta.CARDS cN-01..03, cN-12). Built only for tools/card-portraits.js (never packed or shipped). Species with no
# head module yet borrow the nearest one: mouse -> rat, crow -> pigeon, vulture -> gull, bighorn -> goat (curled
# horns), swan -> goose.
import cspecs as C

PARK = -2

BORROW = {'mouse': ('rat', dict(snout=0.8, ears=1.35, teeth=False)), 'crow': ('pigeon', {}), 'vulture': ('gull', dict(beak=1.15)),
          'bighorn': ('goat', dict(horns='curl', beard=0.0, ears_droop=0.1)), 'swan': ('goose', dict(slim=0.4))}


def characters():
    S = {}
    for cid, c in C.CARDS.items():
        if cid[-2:] not in ('01', '02', '03', '12'):
            continue
        sp = c['species']
        if sp in BORROW:
            real, head = BORROW[sp]
            role = 'pitcher' if c['pos'] == 'P' else 'fielder'
            s = C.base_spec(cid, real, role, c['name'], c['number'], c['seed'], c['face'], c['teamIdx'])
            s['pos'] = c['pos']
            s['head'] = dict(head)
            S[cid] = C.accessory_colors(s)
        else:
            S[cid] = C.card_spec(cid)
        if S[cid]['species'] == 'tortoise':
            S[cid]['gear'] = ['shell']
        S[cid]['lods'] = (0,)
    return S
