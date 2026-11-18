# Countertop deployment

A push to `main` in `nbuzzerio/CookBook` authorizes GitHub Actions to test and publish the static cookbook at **https://www.nickbuzzerio.com/apps/recipes/**. The deployment succeeds when the receiver reads back the expected bytes through public HTTPS. The one-time setup below requires an owner with GitHub repository administration and an authenticated Droplet administrator session.

## What ships

| Event | Validation | Production |
| --- | --- | --- |
| Pull request targeting main | Proposed merge, public dependencies, synthetic fixtures | Skipped |
| Push to main | Pushed commit | Automatic after validation |
| Manual dispatch | Selected ref | Eligible on the owner repository’s current main |
| Rerun | Reuses successful jobs or builds a new artifact on a full rerun | Rechecks current main immediately before upload |

The workflow pins official actions to full commit SHAs and grants `contents: read`. Only the deployment job enters `recipes-production`. It serializes deployments with cancellation disabled. A superseded commit fails the sender’s main-head check. An in-flight release can finish while CI validates a newer push. [Workflow](../.github/workflows/ci-deploy.yml)

The check job installs Node 24.18.0 and pnpm 11.9.0, uses the frozen lockfile, runs TypeScript and the complete Vitest suite, and builds once. It exercises the ZIP through Nginx and Chromium before uploading that single ZIP for seven days. Each check attempt has its own artifact name. The deploy job downloads the artifact selected by the successful check and compares its SHA-256 to the digest passed between jobs.

The current ZIP has **39 files**. These include HTML, the service worker, JS and CSS entry points, 24 WOFF/WOFF2 files, three JPEG covers, the example recipe, two public schemas, the SVG favicon, three license notices and `release.json`. The marker identifies the `recipes` app, base, full commit and SHA-256 of every other file. The packer resolves HTML and CSS references, compares the worker’s precache with the release, and checks the static data against the reviewed `public/` files. It rejects unknown output. A linked `manifest.webmanifest` is supported when supplied. Today’s build has none. [Release inventory and validator](../deploy/bundle.py)

Bundled recipe data and the public example determine which JPEG covers ship. A new referenced cover in the supported path format follows the ordinary release workflow. New kinds of build output require a reviewed inventory change. Update the packer, receiver MIME checks, Nginx rules and fixture coverage together, and install compatible server helpers before the first release using the new contract. Keep retained releases readable during that transition. The archive excludes checkouts, dependency trees, test outputs, local databases, profiles and household backups.

## 1. Inspect the Droplet and establish SSH trust

In the authenticated administrator console, confirm the SSH endpoint and port, the canonical TLS vhost, existing app locations and API proxy. Check whether an existing static cookbook already owns the URL. If it does, plan its handover and preserve the existing serving route before enabling the include. A new, empty release tree serves 404 until first activation.

```bash
sudo sshd -T | grep -E '^(port|hostkey|pubkeyauthentication|authorizedkeysfile|usepam) '
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
sudo awk '{print $1, $2}' /etc/ssh/ssh_host_ed25519_key.pub
sudo nginx -T 2>&1 | less
df -h /var/www
```

Use the active ED25519 key path shown by `sshd -T` if it differs. Record the exact `ssh-ed25519 BASE64` output through this authenticated channel. Use the SSH endpoint reachable from the runner, which may differ from the website hostname. The receiver requires over 3 GiB free beyond the archive size, DNS, a current CA store and outbound HTTPS to the canonical site.

## 2. Generate the dedicated key and transfer setup files

Run these commands from the CookBook checkout in an owner Bash terminal, such as Ubuntu in WSL. Keep the terminal open for GitHub setup. The private key belongs exclusively to Countertop Actions. Generate it in the owner’s home outside the checkout. The transfer uses the owner’s existing administrator identity.

```bash
set -euo pipefail
umask 077
install -d -m 700 "$HOME/.ssh"
key="$HOME/.ssh/countertop-actions"
test ! -e "$key" && test ! -e "$key.pub" || { echo 'Choose a fresh key path'; exit 1; }
ssh-keygen -t ed25519 -N '' -C 'countertop-actions' -f "$key"

read -rp 'Droplet SSH hostname or IPv4 address: ' ssh_host
read -rp 'SSH port: ' ssh_port
read -rp 'Administrator username: ' admin
read -rp 'Trusted ssh-ed25519 BASE64 from the console: ' host_key
pins=$(mktemp)
printf 'recipes-droplet %s\n' "$host_key" > "$pins"
ssh-keygen -lf "$pins" -E sha256
ssh_opts=(-o StrictHostKeyChecking=yes -o HostKeyAlias=recipes-droplet
          -o HostKeyAlgorithms=ssh-ed25519 -o GlobalKnownHostsFile=/dev/null
          -o "UserKnownHostsFile=$pins")
ssh -p "$ssh_port" "${ssh_opts[@]}" "$admin@$ssh_host" 'mkdir -m 700 ~/countertop-ci-setup'
scp -P "$ssh_port" "${ssh_opts[@]}" "$key.pub" deploy/{setup.sh,login.sh,bundle.py,receiver.py,recipes.nginx.conf,countertop-recover.path,countertop-recover.service} "$admin@$ssh_host:countertop-ci-setup/"
```

Compare the printed fingerprint with the console fingerprint. The public key and seven reviewed setup files are the entire server handoff.

## 3. Install the restricted account

On the Droplet, use Ubuntu with systemd, Python 3.10+, OpenSSH, Nginx and distribution-supported Bubblewrap. The installer is for fresh provisioning. It checks for existing account, group, paths and unit names before installation. A partial installation requires inspection of the named resources before resuming.

```bash
cd ~/countertop-ci-setup
sudo apt-get update
sudo apt-get install --no-install-recommends bubblewrap ca-certificates
sudo bash ./setup.sh "$PWD/countertop-actions.pub"

id recipes-deploy
sudo passwd -S recipes-deploy
sudo -l -U recipes-deploy
sudo sshd -T -C "user=recipes-deploy,host=$(hostname),addr=127.0.0.1" |
  grep -E '^(pubkeyauthentication|authorizedkeysfile|authorizedkeyscommand|forcecommand|permituserenvironment|allowusers|denyusers) '
sudo ls -ld /var/lib/recipes-deploy{,/.ssh} /var/lib/recipes-deploy/.ssh/authorized_keys \
  /usr/local/lib/countertop /var/www/countertop{,/releases}
systemctl is-enabled countertop-recover.{service,path}
systemctl is-active countertop-recover.path
sudo -u recipes-deploy /usr/local/lib/countertop/login.sh recover
```

Expect only the private `recipes-deploy` group, a locked password, no sudo grants and the dedicated root-owned authorized key. Check host-specific SSH policy for the actual runner route. The sole key has OpenSSH `restrict,command="receive"`. The root-owned login shell accepts sshd’s forced invocation and starts the receiver without a terminal or forwarding. Its filesystem namespace exposes the Countertop deployment tree for writing, with Python, helpers, resolver files and CA certificates mounted read-only. Other application trees are outside that namespace. Setup exercises the confined receiver before installing the key. If namespace creation is disabled, resolve the host’s Bubblewrap policy and repeat the confined self-check.

The `countertop-recover.path` watcher starts a one-shot service when a transaction is pending. The service waits for the receiver’s lock. It restores an interrupted switch if the publisher died and also runs before Nginx during normal boot. Ordinary releases require neither systemd administration nor Nginx reloads.

## 4. Include the Countertop location in the existing HTTPS vhost

Use the source file identified by `nginx -T` for the `listen 443 ssl` server whose `server_name` includes `www.nickbuzzerio.com`. Save a copy outside all include globs and edit just that server block.

```bash
read -rp 'Absolute path of the canonical HTTPS vhost source: ' vhost
vhost=$(readlink -e -- "$vhost")
sudo cp -a -- "$vhost" "/root/countertop-vhost-before-$(date +%Y%m%d-%H%M%S).conf"
sudoedit "$vhost"
```

Insert this line inside the selected `server { ... }`, alongside its app locations.

```nginx
include /etc/nginx/snippets/countertop.conf;
```

Inspect inherited security headers. If the shared apps matcher supplies additional security headers only in its own location, repeat the reviewed header policy inside the new Countertop location. The effective maximum worker scope must be `/apps/recipes/`. Omitting `Service-Worker-Allowed` gives that default. If the vhost sends a broader value, set a Countertop-only header and retain the other inherited security headers. Check the existing Workout, Calendar and `/api/v1/` location definitions in the effective configuration.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The scoped alias follows `current`, disables open-file caching across switches and serves GET/HEAD. Missing files return 404. The real URL for a hash navigation always loads the directory index. Hashed JS, CSS and fonts get one year of caching. Stable paths including covers, examples, schemas, worker, HTML and release identity revalidate. The worker caches Countertop’s static files and the browser verifies offline deep links and API exclusion. [Nginx snippet](../deploy/recipes.nginx.conf)

## 5. Create the main-only GitHub Environment

Enable Actions in **nbuzzerio/CookBook → Settings → Actions → General** and allow the four pinned official actions. Keep fork pull request secrets and write permissions disabled. Limit main write access to trusted maintainers. The validation job is named `check`.

From the owner terminal use an authenticated administrator `gh` and `jq`. Execute the creation commands for a **new** environment. For an existing environment, inspect it and use the two verification commands below before setting credentials. GitHub must support environment secrets and selected branch restrictions for this repository. [Environment API](https://docs.github.com/en/rest/deployments/environments) · [Deployment branch policy API](https://docs.github.com/en/rest/deployments/branch-policies)

```bash
repo=nbuzzerio/CookBook
env_name=recipes-production
endpoint="repos/$repo/environments/$env_name"
gh auth status
gh api --method PUT "$endpoint" --input - <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api --method POST "$endpoint/deployment-branch-policies" -f name=main -f type=branch
```

Verify that the only deployment rule is the selected branch policy, with exactly one branch named `main`. In the Settings UI this corresponds to **Selected branches and tags → Branch → main**, with no tags, reviewers, wait timers or custom approval rules.

```bash
gh api "$endpoint" | jq -e '
  .deployment_branch_policy == {"protected_branches":false,"custom_branch_policies":true}
  and all(.protection_rules[]?; .type == "branch_policy")'
gh api "$endpoint/deployment-branch-policies" | jq -e '
  .total_count == 1 and .branch_policies[0].name == "main" and .branch_policies[0].type == "branch"'

gh secret set RECIPES_DEPLOY_KEY --repo "$repo" --env "$env_name" < "$key"
gh variable set RECIPES_SSH_HOST --repo "$repo" --env "$env_name" --body "$ssh_host"
gh variable set RECIPES_SSH_PORT --repo "$repo" --env "$env_name" --body "$ssh_port"
gh variable set RECIPES_SSH_HOST_KEY --repo "$repo" --env "$env_name" --body "$host_key"
gh secret list --repo "$repo" --env "$env_name"
gh variable list --repo "$repo" --env "$env_name"
```

The deployment account is fixed as `recipes-deploy`. The SSH port and trusted public host key are required even for port 22. Keep the owner’s private key copy protected or retire it according to the owner’s key policy. A host-key change requires a fresh fingerprint check through the trusted console. [GitHub CLI environment variables](https://cli.github.com/manual/gh_variable_set)

## 6. Trigger and confirm the first release

Confirm the deployed PSS validator version before publishing to any browser with an existing approved binding. From a reviewed, committed local `main`, push the release after infrastructure setup. The following commands are for the owner’s first rollout.

```bash
test "$(git branch --show-current)" = main
sha=$(git rev-parse HEAD)
git push origin main
gh run list --repo nbuzzerio/CookBook --workflow ci-deploy.yml --branch main --commit "$sha"
```

Once the push run appears, use its ID. If the workflow was already installed on current main, `gh workflow run ci-deploy.yml --repo nbuzzerio/CookBook --ref main` explicitly starts the same validated release. A normal push needs no dispatch.

```bash
read -rp 'GitHub Actions run ID: ' run_id
gh run watch "$run_id" --repo nbuzzerio/CookBook --exit-status
gh run view "$run_id" --repo nbuzzerio/CookBook --json headSha,jobs |
  jq -e --arg sha "$sha" '.headSha == $sha and ([.jobs[] | select(.name == "deploy" and .conclusion == "success")] | length == 1)'
base=https://www.nickbuzzerio.com/apps/recipes/
curl -fsS -H 'Cache-Control: no-cache' "${base}release.json" |
  jq -e --arg sha "$sha" '.app == "recipes" and .base == "/apps/recipes/" and .commit == $sha'
curl -fsSI "${base}sw.js"
```

During publication the sender verifies the ZIP checksum, checks the current GitHub main ref and uses pinned, noninteractive public-key SSH. The receiver takes an exclusive lock, reads at most 32 MiB, validates up to 512 regular ZIP entries, rejects duplicate and unknown paths, and verifies the marker and file hashes. It materializes the validated bytes in a temporary directory on the same filesystem. No ZIP-provided pathname is passed to a generic extractor. A retained release for the same commit must match byte for byte.

The receiver journals the previous link, atomically renames `current` to `releases/<full-sha>` and verifies the directory, marker and every public file through canonical HTTPS. It checks exact bytes, MIME and worker scope, rejects redirects and retries transient failures. A failed replacement restores the prior target. A failed first activation removes `current`. Up to five releases are retained, including the active release and its immediate predecessor. Cleanup operates only on recognized directories below `/var/www/countertop/releases/`. The health check uses static GETs. Sync authentication and databases are outside this release protocol.

## Recovery and operator rollback

Use the SSH administrator session. Run recovery after an ambiguous SSH disconnect. If the release lock is busy, wait for the publisher to finish and inspect the result again. The watcher also recovers abandoned transactions without an owner session.

```bash
root=/var/www/countertop
shell=/usr/local/lib/countertop/login.sh
sudo -u recipes-deploy "$shell" recover
readlink "$root/current"
ls -lt "$root/releases"
sudo journalctl -u countertop-recover.service -n 20 --no-pager
```

Select a previously verified commit from the successful deployment log. The command checks the expected current SHA under the lock and verifies the restored release through public HTTPS. If that verification fails it restores the pre-rollback target.

```bash
active=$(basename "$(readlink "$root/current")")
read -rp 'Previously verified full 40-character commit SHA: ' good
sudo -u recipes-deploy "$shell" rollback "$active" "$good"
curl -fsS https://www.nickbuzzerio.com/apps/recipes/release.json | jq -e --arg good "$good" '.commit == $good'
```

Fix or revert main before the next push. For a failed first deployment, correct the reported configuration, credential or TLS problem and rerun the current main workflow. If the seven-day artifact expired, rerun all jobs. A browser with an older active worker may need to close its Countertop tabs and reopen online. Retain its local data, queues and backups.

## Repeat local validation

On a disposable Ubuntu 24.04 environment with Node 24.18.0, use the following commands from the repository root. Run the tests as an ordinary user. The two package installation commands are for the local test machine.

```bash
npm install --global pnpm@11.9.0
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm test
pnpm build
sha=$(git rev-parse HEAD)
archive=$(mktemp --suffix=.zip)
python3 deploy/bundle.py dist "$archive" "$sha"
sudo apt-get update && sudo apt-get install -y nginx python3-paramiko bubblewrap
pnpm exec playwright install --with-deps chromium --only-shell
bash tests/login_smoke.sh
systemd-analyze verify deploy/countertop-recover.{path,service}
/usr/bin/python3 tests/test_release.py
python3 tests/nginx_smoke.py "$archive" "$sha"
```

The Nginx suite creates a loopback TLS certificate and fresh browser profiles. It runs the focused packaged-release smoke and the full `smoke`, `edge-cases`, `backup`, `shopping-notes` and `stretch` suites through the real snippet. Tests include failure with stale bytes served as HTTP 200, a wrong cover MIME type, and a broad worker header. The browser checks the real cache inventory, offline hash navigation, IndexedDB device identity, household cookie and CSRF with a synthetic API. The standalone scripts accept only loopback URLs. QA screenshots and synthetic exports stay outside the release.

**Extended PSS verification** runs locally with the separately prepared private `../personal-sync-service/dist/src`, its installed dependencies and a local Chromium installation (installed Chrome on Windows). From CookBook run `pnpm build` followed by `node scripts/browser-sync.mjs`. The suite creates its own loopback service and temporary SQLite database. Hosted PR validation has neither the private repository nor PSS credentials. Only the extended suite exercises real service reconciliation, conflict resolution and multi-device exchanges.

## Real household rollout

Have the service owner identify the running PSS deployment and match its revision to the reviewed validators for app `recipes` and both record kinds, `recipe` and `shopping-note`. A healthy endpoint alone does not identify its validator build. The reference service uses `personal-sync`. These read-only commands help identify the running process and release directory.

```bash
systemctl show personal-sync -p ActiveState -p MainPID -p WorkingDirectory
pid=$(systemctl show personal-sync -p MainPID --value)
test "$pid" -gt 0 && sudo readlink -f "/proc/$pid/cwd"
```

Save a full cookbook backup and the recovery download on the device that holds the data. Trial a disposable recipe and an opted-in shopping reminder on a physical PC and phone in the same household Space. Verify an offline edit, reconnection and device-local cooking progress before approving uploads of the real collection. [Sync integration and first-connection procedure](PERSONAL_SYNC_INTEGRATION_REPORT.md)

## Verification record · 18 November 2026

| Area | Observed status |
| --- | --- |
| CI implemented | Push, pull request and dispatch triggers; frozen install, typecheck, unit tests, build, packaging and all five standalone suites. Actionlint 1.7.12 passed. All four official action pins resolved. The deploy condition accepted exactly the two eligible cases in 32 local event, ref and repository combinations. |
| CD implemented | Verified archive transfer, dedicated restricted account, atomic symlink activation, HTTPS verification, automatic rollback, recovery watcher, retention and operator rollback. |
| Local validation results | Windows and Ubuntu passed all 93 unit tests and the production build. Ubuntu passed 11 release tests, the restricted-login smoke, systemd unit verification, the packaged Nginx/TLS browser smoke and all five standalone Chromium suites. Real loopback OpenSSH rejected the wrong host key before authentication. The receiver restored the previous release after each injected HTTPS fault. Windows passed the extended private PSS browser suite on a synthetic database. Vite reported its existing Zod annotation and bundle-size advisories. |
| GitHub-hosted validation | Pending the first run of this workflow on GitHub. |
| Live server setup | Pending owner execution. The restricted shell and recovery handler ran locally. Systemd unit syntax was verified. Droplet provisioning, systemd startup and the live vhost require the owner setup above. |
| Production deployment | Pending. All automated deployment and browser checks used local fixtures. |
| Real-data sync readiness | Pending confirmation of the running PSS validators, device backups and a physical two-device trial. |

## Owner checklist

- [ ] Confirm the running PSS validators, save device backups and identify the canonical HTTPS vhost.
- [ ] Record the trusted SSH host key, generate the dedicated Countertop key and install the restricted account and recovery units.
- [ ] Include the Countertop Nginx snippet, test the configuration and reload once.
- [ ] Create the main-only environment, verify its policy and set its one secret and three variables.
- [ ] Push reviewed main, watch both jobs succeed and match the public release marker to the full commit.
- [ ] Trial a disposable recipe and an opted-in reminder on the PC and phone before sharing household data.

