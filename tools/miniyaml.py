"""Minimal OpenRA MiniYaml reader: tab-indented `Key: Value` trees with Inherits."""

from pathlib import Path


class Node:
    __slots__ = ("key", "value", "children")

    def __init__(self, key, value=""):
        self.key = key
        self.value = value
        self.children = []

    def get(self, key):
        for c in self.children:
            if c.key == key:
                return c
        return None

    def val(self, key, default=None):
        n = self.get(key)
        return n.value if n is not None and n.value != "" else default

    def copy(self):
        n = Node(self.key, self.value)
        n.children = [c.copy() for c in self.children]
        return n

    def __repr__(self):
        return f"Node({self.key!r}, {self.value!r}, {len(self.children)} children)"


def parse_text(text):
    root = Node("")
    stack = [(-1, root)]
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        depth = len(line) - len(line.lstrip("\t"))
        body = line.strip()
        if ":" in body:
            k, v = body.split(":", 1)
        else:
            k, v = body, ""
        node = Node(k.strip(), v.strip())
        while stack[-1][0] >= depth:
            stack.pop()
        stack[-1][1].children.append(node)
        stack.append((depth, node))
    return root.children


def merge(into, other):
    """Merge `other` node's children into `into` (OpenRA override semantics)."""
    if other.value != "":
        into.value = other.value
    for oc in other.children:
        if oc.key.startswith("-"):
            into.children = [c for c in into.children if c.key != oc.key[1:]]
            continue
        existing = into.get(oc.key)
        if existing is None:
            into.children.append(oc.copy())
        else:
            merge(existing, oc)


def load_tree(paths):
    """Load many files into a dict of top-level name -> merged Node."""
    defs = {}
    for p in paths:
        for n in parse_text(Path(p).read_text(encoding="utf-8", errors="replace")):
            if n.key in defs:
                merge(defs[n.key], n)
            else:
                defs[n.key] = n
    return defs


def resolve(defs, name, _seen=None):
    """Return a copy of defs[name] with all Inherits applied (parents first)."""
    _seen = _seen or set()
    if name in _seen or name not in defs:
        return Node(name)
    _seen = _seen | {name}
    src = defs[name]
    out = Node(name, src.value)
    for c in src.children:
        if c.key == "Inherits" or c.key.startswith("Inherits@"):
            merge(out, resolve(defs, c.value, _seen))
    own = Node(name)
    own.children = [c.copy() for c in src.children if not (c.key == "Inherits" or c.key.startswith("Inherits@"))]
    merge(out, own)
    return out
