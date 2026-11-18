#!/usr/bin/env bash
# One-time provisioning on Ubuntu, from an owner-reviewed copy of deploy/.
set -euo pipefail
install_deployment_files() {
  install -d -o root -g root -m 0755 "$account_home" "$account_home/.ssh" "$helpers"
  install -o root -g root -m 0644 bundle.py receiver.py "$helpers/"
  install -o root -g root -m 0644 recipes.nginx.conf "$snippet"
  install -d -o "$account" -g "$account" -m 0755 "$root" "$root/releases"
  install -o root -g root -m 0644 countertop-recover.{path,service} "$units/"
}

install_deployment_key() {
  printf 'restrict,command="/usr/bin/python3 -BEs %s/receiver.py receive" %s %s\n' \
    "$helpers" "$key_type" "$key_data" | install -o root -g root -m 0644 /dev/stdin "$account_home/.ssh/authorized_keys"
}

# The provisioning fixture exercises these same install operations in a temporary tree.
[[ ${BASH_SOURCE[0]} == "$0" ]] || return 0
[[ $EUID == 0 ]] || { echo "Run initial setup with sudo." >&2; exit 1; }
cd -- "$(dirname -- "$0")"
pub=${1:?Expected absolute path to fresh Countertop public key}
[[ $pub == /* && -f $pub ]]
ssh-keygen -lf "$pub" >/dev/null
read -r key_type key_data _ < "$pub"
[[ $key_type == ssh-ed25519 && $key_data =~ ^[A-Za-z0-9+/]+=*$ ]]
for file in receiver.py bundle.py recipes.nginx.conf countertop-recover.{path,service}; do test -s "$file"; done

account=recipes-deploy
account_home=/var/lib/recipes-deploy
root=/var/www/countertop
helpers=/usr/local/lib/countertop
snippet=/etc/nginx/snippets/countertop.conf
units=/etc/systemd/system
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

useradd --system --user-group --no-create-home --home-dir "$account_home" --shell /bin/sh --password '!' "$account"
[[ $(id -Gn "$account") == "$account" ]]
if sudo -n -l -U "$account" >/dev/null 2>&1; then
  echo "Unexpected sudo rights for $account. Inspect the host sudo policy." >&2
  exit 1
fi
install_deployment_files
runuser -u "$account" -- /usr/bin/python3 -BEs "$helpers/receiver.py" recover
systemctl daemon-reload
systemctl enable --now countertop-recover.service countertop-recover.path
install_deployment_key
echo "Countertop paths and restricted public key installed. Include $snippet in the www HTTPS server."
