"""Build the double-clickable game. Python 3.9+, no player dependencies."""
import base64
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ("core", "input", "gestures", "ui", "audio", "renderer", "main")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def prepare(root):
    """Only rebuild missing outputs; each producer preserves the other's data."""
    manifest_path = root / "assets/manifest.json"
    manifest = read_json(manifest_path) if manifest_path.exists() else {}
    characters = read_json(root / "assets/characters.json")
    poses = set("roll push1 push2 crouch ollie flip catch manual grind lean_forward lean_back crash".split())
    if set(characters) != {"jeff", "dave"}:
        raise ValueError("Characters must be exactly Jeff and Dave")
    for identifier, prefix in (("jeff", "skater_"), ("dave", "dave_")):
        character = characters[identifier]
        if (character["id"] != identifier or character["name"] != identifier.title() or
                character["previewKey"] != prefix + "roll" or
                character["poses"] != {pose: prefix + pose for pose in poses}):
            raise ValueError("Invalid character definition: " + identifier)
    required = {key for character in characters.values() for key in character["poses"].values()}
    required |= {'jersey_barrier', 'gap_left', 'gap_center', 'gap_right'}
    for section, producer in (("images", "prepare_assets.py"), ("audio", "compose_audio.py")):
        entries = manifest.get(section, {})
        stale_characters = section == "images" and (
            manifest.get("characters") != characters or not required <= entries.keys())
        if stale_characters or not entries or any(not (root / entry["path"]).is_file() for entry in entries.values()):
            subprocess.run([sys.executable, str(root / "scripts" / producer)], cwd=root, check=True)
            manifest = read_json(manifest_path)
    if not required <= manifest["images"].keys() or manifest.get("characters") != characters:
        raise ValueError("Character preparation did not produce every pose")
    return manifest


def embedded(root, entries, kind):
    result = {}
    prefix = "assets/processed/" if kind == "image/png" else "assets/audio/"
    for key, entry in entries.items():
        asset_path = entry["path"]
        path = (root / asset_path).resolve()
        if not asset_path.startswith(prefix) or not path.is_relative_to((root / prefix).resolve()):
            raise ValueError("Non-production asset path: " + asset_path)
        record = dict(entry)
        del record["path"]
        record["src"] = "data:" + kind + ";base64," + base64.b64encode(path.read_bytes()).decode("ascii")
        result[key] = record
    return result


def assemble(root=ROOT):
    manifest = prepare(root)
    data = {
        "characters": manifest["characters"],
        "images": embedded(root, manifest["images"], "image/png"),
        "audio": embedded(root, manifest["audio"], "audio/wav"),
        "settings": read_json(root / "settings.json"),
        "course": read_json(root / "course.json"),
        "provenance": manifest["provenance"],
    }
    # JSON must not be able to terminate its enclosing classic script element.
    serialized = json.dumps(data, separators=(",", ":"), ensure_ascii=True).replace("<", "\\u003c")
    replacements = {"GAME_DATA": "window.SHREDDER_DATA = " + serialized + ";",
                    "STYLE": (root / "web/style.css").read_text(encoding="utf-8")}
    vendor = root / "vendor/zingtouch"
    replacements["ZINGTOUCH_JS"] = "/*\n" + (vendor / "LICENSE").read_text(encoding="utf-8") + "\n*/\n" + (vendor / "zingtouch.min.js").read_text(encoding="utf-8")
    for name in SCRIPTS:
        source = (root / "web" / (name + ".js")).read_text(encoding="utf-8")
        if re.search(r"</script", source, re.IGNORECASE):
            raise ValueError("Script contains an HTML closing tag: " + name)
        replacements[name.upper() + "_JS"] = source
    template = (root / "web/template.html").read_text(encoding="utf-8")
    if set(re.findall(r"\{\{([A-Z_]+)\}\}", template)) != set(replacements):
        raise ValueError("Template placeholders do not match build inputs")
    return re.sub(r"\{\{([A-Z_]+)\}\}", lambda match: replacements[match[1]], template)


def main():
    html = assemble()
    output = ROOT / "index.html"
    output.write_text(html, encoding="utf-8")
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    (dist / "index.html").write_bytes(output.read_bytes())
    print("Built index.html and identical dist/index.html: " + str(output.stat().st_size) + " bytes")


if __name__ == "__main__":
    main()
