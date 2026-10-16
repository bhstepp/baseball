# Head-kit test characters (never shipped): one per family / feature not covered by park 1 - a reptile (lizard),
# antlers (moose), tusks (walrus), a shell (tortoise).
import cspecs as C

PARK = -1


def characters():
    S = {}
    face = dict(pal=['#7DB04E', '#EBDFA0', '#2F4A2A'], acc={}, cap='fwd')
    s = C.base_spec('test_lizard', 'lizard', 'fielder', 'Test Lizard', 7, 777, face, 4)
    s['colors'].update(skin='#7DB04E', fur_light='#EBDFA0', mask='#2F4A2A')
    S['test_lizard'] = s
    for sp, num in (('moose', 38), ('walrus', 11), ('tortoise', 3)):
        pal = (C.DATA['species'].get(sp, {}).get('pal') or [['#8A5A3A', '#D9B49A', '#4A2E20']])[0]
        t = C.base_spec('test_' + sp, sp, 'pitcher', 'Test ' + sp, num, 900 + num, dict(pal=pal, acc={}, cap='fwd'), 2)
        if sp == 'tortoise':
            t['gear'] = ['shell']
            t['colors'].update(skin=pal[0], fur_light=pal[1])
        S['test_' + sp] = t
    return S
