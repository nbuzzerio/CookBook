#!/usr/bin/env bash
# One-time provisioning on Ubuntu, from an owner-reviewed copy of deploy/.
set -euo pipefail
[[ $EUID == 0 ]] || { echo "Run initial setup with sudo." >&2; exit 1; }
cd -- "$(dirname -- "$0")"
pub=${1:?Expected absolute path to fresh Countertop public key}
[[ $pub == /* && -f $pub ]]
ssh-keygen -lf "$pub" >/dev/null
read -r key_type key_data _ < "$pub"
[[ $key_type == ssh-ed25519 && $key_data =~ ^[A-Za-z0-9+/]+=*$ ]]
test -x /usr/bin/bwrap
for file in receiver.py bundle.py login.sh recipes.nginx.conf countertop-recover.{path,service}; do test -s "$file"; done

account=recipes-deploy
account_home=/var/lib/recipes-deploy
root=/var/www/countertop
helpers=/usr/local/lib/countertop
snippet=/etc/nginx/snippets/countertop.conf
if getent passwd "$account" >/dev/null || getent group "$account" >/dev/null; then
  echo "Countertop account or group already exists. Inspect existing provisioning." >&2
  exit 1
fi
for unit in countertop-recover.{path,service}; do
  if systemctl cat "$unit" >/dev/null 2>&1; then echo "Existing unit: $unit" >&2; exit 1; fi
done
for path in "$account_home" "$root" "$helpers" "$snippet" /etc/systemd/system/countertop-recover.{path,service}; do
  if [[ -e $path || -L $path ]]; then echo "Already exists: $path" >&2; exit 1; fi
done

install -d -o root -g root -m 0755 "$account_home" "$account_home/.ssh" "$helpers"
install -o root -g root -m 0644 bundle.py receiver.py "$helpers/"
install -o root -g root -m 0755 login.sh "$helpers/login.sh"
useradd --system --user-group --no-create-home --home-dir "$account_home" --shell "$helpers/login.sh" "$account"
[[ $(id -Gn "$account") == "$account" ]]
if sudo -n -l -U "$account" >/dev/null 2>&1; then
  echo "Unexpected sudo rights for $account. Inspect the host sudo policy." >&2
  exit 1
fi
install -o root -g root -m 0644 recipes.nginx.conf "$snippet"
install -d -o "$account" -g "$account" -m 0755 "$root" "$root/releases"
# Fail closed if namespace creation or the confined Python runtime is unavailable.
runuser -u "$account" -- "$helpers/login.sh" recover
install -o root -g root -m 0644 countertop-recover.{path,service} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now countertop-recover.service countertop-recover.path
printf 'restrict,command="receive" %s %s\n' \
  "$key_type" "$key_data" > "$account_home/.ssh/authorized_keys"
chmod 0644 "$account_home/.ssh/authorized_keys"
echo "Countertop paths and restricted public key installed. Include $snippet in the www HTTPS server."
