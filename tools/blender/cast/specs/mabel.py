# Mabel "Grandma Gas" Quigley - a daily-derby pitcher (goose, #72): a feisty grandma goose on a stout build, thin
# gold spectacles, a white feather bun with curls under the cap band, rosy cheeks and pearls on the collar,
# surprising heat. Built with the extras (park 0: cbuild.py --park 0, or by id). The head kit for her lives in heads/goose.py (head option granny).
# extras.py's derby loop also lists p_mabel; while it does, this module stands down (a character may be defined only
# once - specs/__init__.discover raises otherwise) and the goose module still recognises her by id.
import cspecs as C

PARK = 0
PENDING = {}


def _extras_defines(pid):
    try:
        from specs import extras
        return pid in extras.characters()
    except Exception:            # noqa: BLE001 - a broken extras module is reported by discover() itself
        return False


def characters():
    S = {}
    if _extras_defines('p_mabel'):
        return S
    from specs.park6 import keyed
    C.add(S, PENDING, 'p_mabel', keyed(lambda: C.pitcher_spec(
        'p_mabel', build_name='stout', build=dict(neck=1.45, leg=0.94),
        body=dict(belly=1.42, seat=1.2, chest_d=1.18),
        head=dict(granny=True, beak=1.0, knob=0.8, neck_fwd=0.04),
        accessories=dict(glasses=1, eyeblack=0),
        colors=dict(teeth='#F8F2E2', skin='#F4A6A8', horn='#C9A04A'))))
    return S
