#!/usr/bin/env bash
# Exercise the installer's real ownership and forced-command settings in /tmp.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run this provisioning fixture with sudo.' >&2; exit 1; }
cd -- "$(dirname -- "$0")/../deploy"
source ./setup.sh
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
chmod 0755 "$scratch"
account=daemon  # Ubuntu's existing unprivileged account with a same-named group
helpers=$scratch/helpers
account_home=$scratch/home
root=$scratch/countertop
snippet=$scratch/countertop.conf
units=$scratch/units
mkdir "$units" "$scratch/sibling"
echo 'other application' > "$scratch/sibling/index.html"
key_type=ssh-ed25519
key_data=fixture
install_deployment_files
install_deployment_key

keyfile=$account_home/.ssh/authorized_keys
forced="/usr/bin/python3 -BEs $helpers/receiver.py receive"
[[ $(cat "$keyfile") == "restrict,command=\"$forced\" $key_type $key_data" ]]
for path in "$account_home" "$account_home/.ssh" "$helpers"; do
  [[ $(stat -c '%u:%g:%a' "$path") == 0:0:755 ]]
done
for path in "$keyfile" "$helpers"/*.py "$snippet" "$units"/*; do
  [[ $(stat -c '%u:%g:%a' "$path") == 0:0:644 ]]
done
for path in "$root" "$root/releases"; do
  [[ $(stat -c '%U:%G:%a' "$path") == "$account:$account:755" ]]
done

# Redirect only the receiver's fixed release root in the disposable copy.
sed -i "s|^ROOT = Path(\"/var/www/countertop\")$|ROOT = Path(\"$root\")|" "$helpers/receiver.py"
grep -Fxq "ROOT = Path(\"$root\")" "$helpers/receiver.py"
as_deployer=(runuser -u "$account" --)
for path in "$helpers" "$keyfile" "$scratch/sibling" "$scratch/sibling/index.html"; do
  "${as_deployer[@]}" test ! -w "$path"
done
sha=$(printf '%040d' 1)
checksum=$(printf '%064d' 1)
# Invoke the actual forced command via sh -c, as sshd does. Original text is data.
for request in '' sh recover recover-wait "rollback $sha $sha" "publish ../sibling $checksum" "publish $sha $checksum extra"; do
  if "${as_deployer[@]}" env SSH_ORIGINAL_COMMAND="$request" /bin/sh -c "$forced" </dev/null 2>"$scratch/error"; then exit 1; fi
  grep -Fq 'expected publish COMMIT SHA256' "$scratch/error"
done
[[ ! -e $root/.lock ]]
if "${as_deployer[@]}" env SSH_ORIGINAL_COMMAND="publish $sha $checksum" /bin/sh -c "$forced" </dev/null 2>"$scratch/error"; then exit 1; fi
grep -Fq 'SHA-256 mismatch' "$scratch/error"
[[ $(stat -c '%U' "$root/.lock") == "$account" ]]
[[ $(cat "$scratch/sibling/index.html") == 'other application' ]]
echo 'PASS installed ownership, forced command, unprivileged receiver and sibling permissions'
