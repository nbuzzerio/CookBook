#!/usr/bin/env bash
# Exercise the installed login shell's mount and command policy as an ordinary user.
set -euo pipefail
test "$(id -u)" -ne 0
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
mkdir -p "$scratch/helpers" "$scratch/tree/releases"
cp deploy/{bundle,receiver}.py "$scratch/helpers/"
touch "$scratch/sibling"
# Substitute only the local bind sources and the test machine's bwrap binary.
# The destination paths, shell dispatch and namespace flags come from the installer.
sed -e "s|exec /usr/bin/bwrap|exec ${BWRAP_BIN:-/usr/bin/bwrap}|" \
    -e "s|--ro-bind /usr/local/lib/countertop |--ro-bind $scratch/helpers |" \
    -e "s|--bind /var/www/countertop |--bind $scratch/tree |" deploy/login.sh > "$scratch/login"
sh "$scratch/login" recover
test -f "$scratch/tree/.lock"
if sh "$scratch/login" -c sh; then exit 1; fi
if SSH_ORIGINAL_COMMAND=recover sh "$scratch/login" -c receive 2>"$scratch/error"; then exit 1; fi
grep -q 'expected publish COMMIT SHA256' "$scratch/error"
# An instrumented helper runs inside the exact same login namespace.
cat > "$scratch/helpers/receiver.py" <<EOF
import os, socket, ssl, sys
from pathlib import Path
assert sys.argv[1:] == ['receive']
assert os.environ['SSH_ORIGINAL_COMMAND'] == 'test'
assert not Path('$scratch/sibling').exists()
assert list(Path('/var/www').iterdir()) == [Path('/var/www/countertop')]
assert ssl.create_default_context().get_ca_certs()
assert socket.getaddrinfo('localhost', 443)
assert 'PRIVATE_FIXTURE_VALUE' not in os.environ
try:
    Path('/usr/local/lib/countertop/writable').touch()
except PermissionError:
    pass
except OSError as error:
    import errno
    assert error.errno == errno.EROFS
else:
    raise AssertionError('writable helper')
EOF
PRIVATE_FIXTURE_VALUE=secret SSH_ORIGINAL_COMMAND=test sh "$scratch/login" -c receive
echo 'PASS restricted command, isolated tree, read-only helpers, resolver and CA store'
