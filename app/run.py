#!/usr/bin/env python3
"""Entrypoint: wspolna walidacja preview/write, potem start servera."""
from write_validate import apply_parity_patches

apply_parity_patches()

from server import main

if __name__ == "__main__":
    main()
