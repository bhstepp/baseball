# heads - species head modules for the cast generator (the head kit contract: docs/CAST-CONTRACT.md "Head kit").
# heads/<species>.py defines FAMILY ('mammal' | 'bird' | 'reptile') and build(ctx) -> hkit.Head, usually a params dict
# handed to its family builder (fam_mammal / fam_bird / fam_reptile) plus a features() hook for the species' pieces.
import importlib


def module(species):
    return importlib.import_module('heads.' + species)


def build(ctx):
    return module(ctx.spec['species']).build(ctx)
