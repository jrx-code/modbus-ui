"""Shared setup for the modbus-ui tests.

No hardware and no network: the app modules are imported straight from app/,
server.py reads deploy/config.example.json (192.0.2.x documentation addresses),
and every attempt to open a network connection fails the test.
"""

import importlib
import json
import os
import shutil
import socket
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
sys.path.insert(0, str(APP))


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("tests must not open network connections")
    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


@pytest.fixture(scope="session")
def server(tmp_path_factory):
    """server.py loads its config at import time (CFG = load_config()), so the
    environment has to point at test files before the first import."""
    tmp = tmp_path_factory.mktemp("modbus-ui")
    cfg = tmp / "config.json"
    shutil.copy(ROOT / "deploy" / "config.example.json", cfg)
    os.environ["CONFIG_FILE"] = str(cfg)
    os.environ["OVERRIDE_FILE"] = str(tmp / "overrides.json")
    os.environ["AUDIT_FILE"] = str(tmp / "audit.jsonl")
    os.environ["MODULES_FILE"] = str(tmp / "modules.json")
    sys.modules.pop("server", None)
    mod = importlib.import_module("server")
    assert mod.CONFIG_FILE == str(cfg)
    return mod


@pytest.fixture(scope="session")
def example_units():
    cfg = json.loads((ROOT / "deploy" / "config.example.json").read_text())
    return cfg["devices"][0]["units"]
