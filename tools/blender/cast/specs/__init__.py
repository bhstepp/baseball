# specs - character specs for the cast generator, one module per park (park1.py ... park6.py), extras.py (the
# derby / daily pitchers, the umpire, Rocco's teammates) and tests.py (head-kit test characters, never shipped).
# Each module defines PARK (an int; 0 = extras, -1 = tests) and characters() -> {id: spec}, built with the helpers in
# cspecs.py (pitcher_spec, card_spec, ...). Modules are discovered automatically: adding a park is adding a file.
import os
import importlib

HERE = os.path.dirname(os.path.abspath(__file__))


ERRORS = {}       # module -> error text (a broken park module never blocks the others)
PENDING = {}      # id -> species whose head module does not exist yet


def discover():
    """{id: spec} over every spec module; each spec gets 'park' (its module's PARK) and 'source' (module name)."""
    out = {}
    ERRORS.clear()
    PENDING.clear()
    for name in sorted(f[:-3] for f in os.listdir(HERE) if f.endswith('.py') and not f.startswith('_')):
        try:
            m = importlib.import_module('specs.' + name)
            chars = m.characters()
            PENDING.update(getattr(m, 'PENDING', {}) or {})
        except Exception as e:          # noqa: BLE001 - report and carry on with the other parks
            import traceback
            ERRORS[name] = '%s: %s' % (type(e).__name__, e)
            print('[cspecs] specs/%s.py failed: %s' % (name, ERRORS[name]))
            traceback.print_exc()
            continue
        for cid, s in chars.items():
            if cid in out:
                raise ValueError('character %s defined twice (%s and %s)' % (cid, out[cid]['source'], m.__name__))
            s['id'] = cid
            s.setdefault('park', getattr(m, 'PARK', 0))
            s['source'] = m.__name__.split('.')[-1]
            out[cid] = s
    return out
