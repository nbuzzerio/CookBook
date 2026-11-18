"""Exercise the real Countertop packer and Linux receiver in disposable directories."""
import contextlib
import concurrent.futures
import io
import json
import multiprocessing
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
import zipfile

import paramiko

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "deploy"))
from bundle import WEBMANIFEST, digest, pack, unpack, validate
from receiver import activate, current, locked, publish, read_release, switch


class Releases(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        (self.root / "releases").mkdir()
        self.first = "1" * 40
        self.next = "2" * 40

    def package(self, sha):
        path = self.root / "package.zip"
        pack(REPO / "dist", path, sha)
        return path.read_bytes()

    def send(self, sha, data=None, checksum=None, probe=None):
        data = self.package(sha) if data is None else data
        def check(files, commit):
            self.assertEqual(current(self.root), commit)
            self.assertEqual(files["index.html"], (self.root / "current/index.html").read_bytes())
        with contextlib.redirect_stdout(io.StringIO()):
            publish(self.root, f"publish {sha} {checksum or digest(data)}", io.BytesIO(data), probe or check)

    def test_incomplete_corrupt_and_unexpected_uploads_preserve_previous(self):
        self.send(self.first)
        valid = self.package(self.next)
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            self.send(self.next, valid[:-1], digest(valid))
        with self.assertRaises(zipfile.BadZipFile):
            self.send(self.next, valid[:-30])
        for wrong in ("missing", "modified", "extra", "path", "symlink", "different commit"):
            changed = io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(valid)) as src, zipfile.ZipFile(changed, "w") as dst:
                for name in src.namelist():
                    if wrong == "missing" and name == "sw.js":
                        continue
                    info = zipfile.ZipInfo(name)
                    if wrong == "symlink" and name == "sw.js":
                        info.external_attr = (stat.S_IFLNK | 0o777) << 16
                    dst.writestr(info, b"wrong" if wrong == "modified" and name == "index.html" else src.read(name))
                if wrong == "extra":
                    dst.writestr("node_modules/payload.js", b"x")
                if wrong == "path":
                    dst.writestr("../other-app", b"x")
            with self.subTest(wrong=wrong), self.assertRaises((ValueError, KeyError)):
                self.send(self.first if wrong == "different commit" else self.next, changed.getvalue())
            self.assertEqual(read_release(self.root, current(self.root))["sw.js"],
                             (REPO / "dist/sw.js").read_bytes())
            self.assertEqual(current(self.root), self.first)
            self.assertFalse((self.root / "releases" / self.next).exists())

    def test_production_subpath_public_files_fonts_and_worker_inventory(self):
        for fault in ("base", "cover", "cover-reference", "font", "unexpected", "worker", "db", "symlink", "backup"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(dir=self.root) as tmp:
                dist = Path(tmp) / "dist"
                shutil.copytree(REPO / "dist", dist)
                if fault == "base":
                    page = dist / "index.html"
                    page.write_bytes(page.read_bytes().replace(b"/apps/recipes/", b"/apps/calendar/"))
                elif fault == "cover":
                    (dist / "assets/images/ziti.jpg").unlink()
                elif fault == "cover-reference":
                    entry = next(dist.glob("assets/*.js"))
                    entry.write_bytes(entry.read_bytes().replace(b"assets/images/sausage.jpg", b"assets/images/missing.jpg"))
                elif fault == "font":
                    next(dist.glob("assets/*.woff2")).unlink()
                elif fault == "worker":
                    worker = dist / "sw.js"
                    worker.write_bytes(worker.read_bytes().replace(b"./index.html", b"/api/v1/auth/session"))
                elif fault == "symlink":
                    (dist / "other.svg").symlink_to(dist / "favicon.svg")
                else:
                    name = {"unexpected": "assets/index-abcd1234.js", "db": "local.sqlite", "backup": "backup.json"}[fault]
                    (dist / name).write_bytes(b"synthetic")
                with self.assertRaises(ValueError):
                    pack(dist, self.root / "invalid.zip", self.next)

    def test_unexpected_command_and_redirected_release_tree(self):
        with self.assertRaisesRegex(ValueError, "expected publish"):
            publish(self.root, "recover", io.BytesIO())
        with tempfile.TemporaryDirectory() as sibling:
            (self.root / "releases").rmdir()
            (self.root / "releases").symlink_to(sibling)
            with self.assertRaisesRegex(ValueError, "symlink"):
                self.send(self.first)
            self.assertEqual(list(Path(sibling).iterdir()), [])

    def test_optional_webmanifest_requires_a_link_and_countertop_scope(self):
        files = unpack(io.BytesIO(self.package(self.first)), self.first)
        files["index.html"] = files["index.html"].replace(
            b"</head>", b'<link rel="manifest" href="./manifest.webmanifest"></head>')
        files["sw.js"] = files["sw.js"].replace(b"const assets = [", b'const assets = ["./manifest.webmanifest",')
        marker = json.loads(files["release.json"])
        for scope in ("./", "/"):
            files[WEBMANIFEST] = json.dumps({"scope": scope, "start_url": "./", "icons": [{"src": "./favicon.svg"}]}).encode()
            marker["files"] = {name: digest(data) for name, data in files.items() if name != "release.json"}
            files["release.json"] = json.dumps(marker).encode()
            if scope == "./":
                validate(files, self.first)
            else:
                with self.assertRaisesRegex(ValueError, "manifest scope"):
                    validate(files, self.first)

    def test_health_failure_rolls_back_and_fails_first_and_subsequent_publish(self):
        def fail(_files, sha):
            self.assertEqual(current(self.root), sha)
            raise OSError("HTTPS failed")
        for prior in (None, self.first):
            if prior:
                self.send(prior)
            with self.assertRaisesRegex(OSError, "HTTPS failed"):
                self.send(self.next, probe=fail)
            self.assertEqual(current(self.root), prior)
            self.assertFalse((self.root / ".pending").exists())

    def test_retries_rollback_and_interrupted_switch(self):
        self.send(self.first)
        self.send(self.next)
        self.send(self.next)
        for target in (self.first, self.next):
            with locked(self.root):
                activate(self.root, read_release(self.root, target), target, lambda *_: None)
            self.assertEqual(current(self.root), target)
        # Simulate a process killed after rename but before a successful probe.
        (self.root / ".pending").write_text(json.dumps([self.first, self.next]))
        with locked(self.root):
            self.assertEqual(current(self.root), self.first)
            with self.assertRaises(BlockingIOError):
                self.send(self.next)

    def test_recovery_waits_for_publisher_and_restores_after_process_death(self):
        self.send(self.first)
        ctx = multiprocessing.get_context("fork")
        activated = ctx.Event()
        def stop_during_probe(*_):
            activated.set()
            threading.Event().wait(20)
        child = ctx.Process(target=self.send, args=(self.next,), kwargs={"probe": stop_during_probe})
        child.start()
        try:
            self.assertTrue(activated.wait(10))
            self.assertEqual(current(self.root), self.next)
            with self.assertRaises(BlockingIOError), locked(self.root):
                self.fail("second publisher entered the transaction")
        finally:
            child.kill()
            child.join(10)
        with locked(self.root, wait=True):
            self.assertEqual(current(self.root), self.first)
            self.assertFalse((self.root / ".pending").exists())

    def test_retry_refuses_damaged_retained_release(self):
        self.send(self.first)
        self.send(self.next)
        (self.root / "releases" / self.first / "assets/images/ziti.jpg").write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            self.send(self.first)
        self.assertEqual(current(self.root), self.next)

    def test_retention_keeps_previous_and_unrelated_paths(self):
        releases = self.root / "releases"
        (releases / "untouched").mkdir()
        other = self.root / "other"
        other.mkdir()
        (releases / ("f" * 40)).symlink_to(other)
        foreign = releases / ("a" * 40)
        foreign.mkdir()
        (foreign / "release.json").write_text('{"app":"workout"}')
        for i in range(1, 7):
            self.send(str(i) * 40)
        with locked(self.root):
            switch(self.root, "2" * 40)
        self.send("7" * 40)
        self.send("7" * 40)
        self.assertEqual(len([p for p in releases.iterdir() if (p / "sw.js").is_file()]), 5)
        self.assertEqual((foreign / "release.json").read_text(), '{"app":"workout"}')
        self.assertTrue((releases / ("2" * 40) / "sw.js").is_file())
        self.assertTrue((releases / "untouched").exists() and other.exists())

    def test_ssh_sender_fails_closed(self):
        env = {"PATH": str(self.root) + ":" + os.environ["PATH"]}
        script = ["bash", "deploy/publish.sh", str(self.root / "package.zip")]
        def run():
            return subprocess.run(script, env=env, cwd=REPO, text=True, capture_output=True)
        result = run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing recipes-production secret RECIPES_DEPLOY_KEY", result.stderr)
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(self.root / "key")], check=True)
        key = (self.root / "key").read_text()
        data = self.package(self.first)
        env.update(RECIPES_DEPLOY_KEY=key, RECIPES_SSH_HOST="test.invalid", RECIPES_SSH_PORT="22",
                   RECIPES_SSH_HOST_KEY=" ".join((self.root / "key.pub").read_text().split()[:2]),
                   ARTIFACT_SHA256=digest(data), GITHUB_SHA=self.first, GITHUB_REPOSITORY="local/fixture")
        for name in ("RECIPES_SSH_HOST", "RECIPES_SSH_PORT", "RECIPES_SSH_HOST_KEY"):
            prior = env.pop(name)
            result = run()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Missing " + name, result.stderr)
            env[name] = prior
        gh, ssh = self.root / "gh", self.root / "ssh"
        gh.write_text('#!/bin/sh\necho "$FAKE_HEAD"\n')
        ssh.write_text('#!/bin/sh\ncat >/dev/null\nexit 47\n')
        gh.chmod(0o755)
        ssh.chmod(0o755)
        env["FAKE_HEAD"] = self.next
        result = run()
        self.assertIn("Superseded commit", result.stderr)
        env["FAKE_HEAD"] = self.first
        result = run()
        self.assertEqual(result.returncode, 47, result.stderr)
        self.assertNotIn(key, result.stdout + result.stderr)
        env["ARTIFACT_SHA256"] = "0" * 64
        self.assertNotIn(run().returncode, (0, 47))

    def test_real_ssh_rejects_wrong_host_and_transmits_checked_bytes_with_correct_pin(self):
        archive = self.package(self.first)
        for name in ["client", "server"]:
            subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", self.root / name], check=True)
        host = paramiko.Ed25519Key.from_private_key_file(str(self.root / "server"))
        client = paramiko.Ed25519Key.from_private_key_file(str(self.root / "client"))
        gh = self.root / "gh"
        gh.write_text('#!/bin/sh\necho "$GITHUB_SHA"\n')
        gh.chmod(0o755)

        class Endpoint(paramiko.ServerInterface):
            def __init__(self):
                self.command = None
                self.executing = threading.Event()
                self.auth_attempts = []

            def check_auth_publickey(self, username, key):
                self.auth_attempts.append(username)
                if username == "recipes-deploy" and key == client:
                    return paramiko.AUTH_SUCCESSFUL
                return paramiko.AUTH_FAILED

            def get_allowed_auths(self, username):
                return "publickey"

            def check_channel_request(self, kind, _channel):
                return paramiko.OPEN_SUCCEEDED if kind == "session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

            def check_channel_exec_request(self, channel, command):
                self.command = command.decode()
                self.executing.set()
                return True

        def serve(listener, endpoint):
            peer, _ = listener.accept()
            with peer, paramiko.Transport(peer) as transport:
                transport.add_server_key(host)
                try:
                    transport.start_server(server=endpoint)
                except EOFError:
                    return
                channel = transport.accept(10)
                if channel is not None:
                    with channel, channel.makefile("rb") as stream:
                        channel.settimeout(10)
                        self.assertTrue(endpoint.executing.wait(10))
                        publish(self.root, endpoint.command, stream, lambda *_: None)
                        channel.send_exit_status(0)

        for trusted in [False, True]:
            endpoint = Endpoint()
            with socket.socket() as listener, concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                listener.bind(("127.0.0.1", 0))
                listener.listen()
                listener.settimeout(15)
                future = pool.submit(serve, listener, endpoint)
                pin = host if trusted else client
                env = dict(PATH=str(self.root) + ":" + os.environ["PATH"], RECIPES_SSH_HOST="127.0.0.1",
                           RECIPES_SSH_PORT=str(listener.getsockname()[1]), RECIPES_SSH_HOST_KEY="ssh-ed25519 " + pin.get_base64(),
                           RECIPES_DEPLOY_KEY=(self.root / "client").read_text(), ARTIFACT_SHA256=digest(archive),
                           GITHUB_SHA=self.first, GITHUB_REPOSITORY="nbuzzerio/CookBook", LC_ALL="C")
                result = subprocess.run(["bash", "deploy/publish.sh", self.root / "package.zip"], env=env,
                                        cwd=REPO, capture_output=True, text=True, timeout=20)
                future.result(timeout=15)
            if trusted:
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(current(self.root), self.first)
            else:
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Host key verification failed", result.stderr)
                self.assertEqual(endpoint.auth_attempts, [])
                self.assertIsNone(current(self.root))


if __name__ == "__main__":
    unittest.main(verbosity=2)
