#!/bin/sh
# Root-owned login shell. sshd invokes this as "login.sh -c receive".
set -eu
case "$#:${1:-}" in
  2:-c) [ "$2" = receive ] || exit 1; set -- receive ;;
  1:recover|1:recover-wait|3:rollback) ;; # direct invocation by the local administrator or systemd
  *) exit 1 ;;
esac
exec /usr/bin/bwrap --unshare-all --share-net --new-session --cap-drop ALL \
  --clearenv --setenv SSH_ORIGINAL_COMMAND "${SSH_ORIGINAL_COMMAND:-}" \
  --ro-bind /usr/bin/python3 /usr/bin/python3 --ro-bind /usr/lib /usr/lib \
  --symlink usr/lib /lib --ro-bind-try /lib64 /lib64 \
  --ro-bind /usr/local/lib/countertop /usr/local/lib/countertop \
  --ro-bind /etc/hosts /etc/hosts --ro-bind /etc/resolv.conf /etc/resolv.conf \
  --ro-bind /etc/nsswitch.conf /etc/nsswitch.conf --ro-bind /etc/ssl/certs /etc/ssl/certs \
  --dev /dev --tmpfs /tmp --bind /var/www/countertop /var/www/countertop \
  -- /usr/bin/python3 -BEs /usr/local/lib/countertop/receiver.py "$@"
