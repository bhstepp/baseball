# rk_model.py - assembles Rocco's parts into the five exported meshes.
import numpy as np
import rk_geo as G
import rk_rig as RR


def build_all(args):
    import rk_head as HD
    import rk_body as BD
    import rk_parts as PT
    head_parts, pupil_parts, head_f = HD.build()
    body_parts, decal_parts, torso_f = BD.build()
    extra = []
    for s in (1, -1):
        extra += PT.glove_parts(s)
        extra += PT.shoe_parts(s)
    extra += PT.tail_part()
    cap = PT.cap_parts(HD.cranium_sdf())
    # place the head (and everything modelled with it) with the head transform
    for p in head_parts + pupil_parts + cap:
        p.V = RR.hx(p.V)
        p.sk = {k: d * RR.HEAD_SCALE for k, d in p.sk.items()}
    extra += cap
    head = G.merge(head_parts, 'rocco_head')
    pupils = G.merge(pupil_parts, 'rocco_pupils')
    body = G.merge(body_parts + extra, 'rocco_body')
    decals = G.merge(decal_parts, 'rocco_decals')
    bat = PT.bat_part()
    if getattr(args, 'verbose', False):
        for p in head_parts + pupil_parts + body_parts + extra + [bat]:
            print('   part %-14s %5d tris  %s' % (p.name, p.tri_count(), ','.join(sorted(set(p.mat)))))
    return head, pupils, body, decals, bat
