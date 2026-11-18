"""Build and independently read back a bounded, deterministic Countertop release ZIP."""
import hashlib
import json
import re
import stat
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin


BASE = "/apps/recipes/"
ORIGIN = "https://www.nickbuzzerio.com"
SHA = re.compile(r"[0-9a-f]{40}")
LIMIT = 32 * 1024 * 1024
WEBMANIFEST = "manifest.webmanifest"
PUBLIC = {
    "examples/recipe.json", "collection.schema.json", "recipe.schema.json", "favicon.svg",
    "licenses/lucide.txt", "licenses/dm-sans.txt", "licenses/libre-baskerville.txt",
}
COVER = re.compile(r"assets/images/[a-z0-9][a-z0-9-]*\.jpg")
ENTRY = re.compile(r"assets/index-[A-Za-z0-9_-]{8,}\.(?:js|css)")
FONT = re.compile(r"assets/(?:dm-sans|libre-baskerville)-[a-z0-9-]+-[a-zA-Z0-9_-]{8,}\.woff2?")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def allowed(name):
    return (name in PUBLIC | {"index.html", "sw.js", "release.json", WEBMANIFEST}
            or COVER.fullmatch(name) or ENTRY.fullmatch(name) or FONT.fullmatch(name))


class EntryLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        require(tag != "base", "unexpected HTML base")
        for key in ("src", "href"):
            if key in attrs:
                self.links.append((tag, attrs.get("rel", ""), attrs[key]))


def validate(files, commit):
    require(SHA.fullmatch(commit), "invalid commit")
    require(PUBLIC | {"index.html", "sw.js", "release.json"} <= files.keys(), "missing required Countertop asset")
    require(all(files.values()) and all(map(allowed, files)), "empty or unknown release file")
    hashes = {name: digest(data) for name, data in files.items() if name != "release.json"}
    marker = {"app": "recipes", "base": BASE, "commit": commit, "files": hashes}
    require(json.loads(files["release.json"]) == marker, "release identity or checksum mismatch")

    html = EntryLinks()
    html.feed(files["index.html"].decode())
    entries = set()
    linked = set()
    for tag, rel, ref in html.links:
        if rel in ("icon", "manifest"):
            name = "favicon.svg" if rel == "icon" else WEBMANIFEST
            require(tag == "link" and name in files and urljoin(ORIGIN + BASE, ref) == ORIGIN + BASE + name,
                    f"incorrect {rel} link")
            linked.add(name)
            continue
        name = ref.removeprefix(BASE)
        require(ref.startswith(BASE) and ENTRY.fullmatch(name) and name in files, "wrong production base or entry")
        require((tag == "script" and name.endswith(".js")) or (rel == "stylesheet" and name.endswith(".css")),
                "incorrect entry type")
        entries.add(name)
    require(any(n.endswith(".js") for n in entries) and any(n.endswith(".css") for n in entries),
            "missing JS or CSS entry")
    require("favicon.svg" in linked, "missing favicon link")
    # Vite embeds the bundled recipe documents in the JS entry and preserves
    # their literal public cover URLs. Independently resolve the example too.
    covers = {json.loads(files["examples/recipe.json"])["coverImage"]}
    for name in entries:
        if name.endswith(".js"):
            covers.update(re.findall(r"""["'](assets/images/[^"']+)["']""", files[name].decode()))
    for cover in covers:
        require(COVER.fullmatch(cover) and files.get(cover, b"").startswith(b"\xff\xd8\xff"),
                f"missing or invalid recipe cover: {cover}")
    if WEBMANIFEST in linked:
        manifest = json.loads(files[WEBMANIFEST])
        for key in ("start_url", "scope"):
            require(urljoin(ORIGIN + BASE, manifest[key]) == ORIGIN + BASE, f"incorrect manifest {key}")
        for icon in manifest.get("icons", []):
            url = urljoin(ORIGIN + BASE, icon["src"])
            require(url.removeprefix(ORIGIN + BASE) in covers | {"favicon.svg"}, "incorrect manifest icon")
    fonts = set()
    for name in entries:
        if name.endswith(".css"):
            for ref in re.findall(r"""url\(\s*['"]?([^)'"]+)['"]?\s*\)""", files[name].decode(), re.I):
                if ref.startswith(("data:", "#")):
                    continue
                url = urljoin(ORIGIN + BASE + name, ref)
                asset = url.removeprefix(ORIGIN + BASE)
                require(FONT.fullmatch(asset) and asset in files, f"unresolved stylesheet URL: {ref}")
                fonts.add(asset)
    require(fonts and files.keys() == PUBLIC | entries | fonts | covers | linked | {"sw.js", "index.html", "release.json"},
            "unexpected or unreferenced release asset")
    worker = files["sw.js"].decode()
    listing = re.search(r"^const assets = (\[.*\]);$", worker, re.M)
    expected = sorted("./" + n for n in hashes if n != "sw.js")
    require(listing and sorted(json.loads(listing[1])) == expected, "incorrect service worker precache")


def pack(directory, archive, commit):
    require(directory.is_dir() and not directory.is_symlink(), "invalid dist directory")
    files = {}
    for path in sorted(directory.rglob("*")):
        require(not path.is_symlink(), f"symlink in dist: {path}")
        if path.is_dir():
            continue
        name = path.relative_to(directory).as_posix()
        require(path.is_file() and allowed(name) and name != "release.json", f"unaccounted dist file: {name}")
        files[name] = path.read_bytes()
    # All unbundled data must match the reviewed public source byte for byte.
    public = Path(__file__).resolve().parents[1] / "public"
    sources = {p.relative_to(public).as_posix() for p in public.rglob("*") if p.is_file()}
    expected_sources = PUBLIC | {n for n in files if COVER.fullmatch(n) or n == WEBMANIFEST}
    require(sources == expected_sources,
            "public source inventory changed; review deployment policy")
    for name in sources:
        path = public / name
        require(path.resolve() == public / name and files.get(name) == path.read_bytes(), f"missing or altered {name}")
    marker = {"app": "recipes", "base": BASE, "commit": commit,
              "files": {name: digest(data) for name, data in files.items()}}
    files["release.json"] = json.dumps(marker, sort_keys=True).encode() + b"\n"
    validate(files, commit)
    with zipfile.ZipFile(archive, "w") as output:
        for name, data in files.items():
            output.writestr(zipfile.ZipInfo(name), data)
    require(archive.stat().st_size <= LIMIT, "archive exceeds size limit")


def unpack(stream, commit):
    with zipfile.ZipFile(stream) as archive:
        entries = archive.infolist()
        require(len(entries) <= 512 and sum(i.file_size for i in entries) <= LIMIT, "oversized release")
        files = {}
        for info in entries:
            name = info.orig_filename
            require(name == info.filename and allowed(name) and name not in files
                    and info.compress_type == zipfile.ZIP_STORED
                    and stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG),
                    f"unexpected ZIP entry: {name!r}")
            files[name] = archive.read(info)
    validate(files, commit)
    return files


if __name__ == "__main__":
    _, source, target, sha = sys.argv
    pack(Path(source), Path(target), sha)
    with open(target, "rb") as stream:
        inventory = unpack(stream, sha)
    print(f"{len(inventory)} release files, SHA-256 {digest(Path(target).read_bytes())}")
