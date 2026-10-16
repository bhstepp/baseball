# Extras - characters outside the parks' home teams: the umpire (a mole, every game), Rocco's teammates who run the
# bases (otter, fox, beaver: LOD1, Rocco's team colours) and the derby / daily pitchers (badger, goose, squirrel: they
# build once their species head modules exist).
import cspecs as C

PARK = 0
PENDING = {}


def characters():
    S = {}
    S['ump'] = C.umpire_spec()
    for sp, num in (('otter', 8), ('fox', 3), ('beaver', 14)):
        S['mate_' + sp] = C.mate_spec(sp, num, {})
    for pid in ('p_bpbob', 'p_mabel', 'p_ike'):          # derby / daily pitchers
        if pid in C.PITCHERS:
            C.add(S, PENDING, pid, lambda pid=pid: C.pitcher_spec(pid))
    return S
