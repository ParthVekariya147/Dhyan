#!/usr/bin/env bash
#
# વર્ણી ધ્યાન — prepare a fresh Ubuntu server to run this deployment.
#
#   ssh root@YOUR_VPS_IP
#   bash vps-setup.sh                    # creates the deploy user, Docker, firewall
#   bash vps-setup.sh --harden-ssh       # ALSO disables password login (read the warning)
#
# Tested against Ubuntu 24.04 LTS. Run once, as root, on a machine with nothing on it.
# Everything it does is idempotent, so running it again after a change is safe.
#
# ════════════════════════════════════════════════════════════════════════════════════════════
# WHAT THIS SETS UP, AND THE ONE THING IT DELIBERATELY DOES NOT
# ════════════════════════════════════════════════════════════════════════════════════════════
#
#   ✓  system packages, current
#   ✓  Docker Engine + the compose plugin, from Docker's own apt repository
#   ✓  a non-root `deploy` user, in the docker group
#   ✓  /opt/varni-dhyan, owned by that user
#   ✓  ufw allowing 22, 80 and 443, and nothing else
#   ✓  daemon-wide log rotation, so containers cannot fill the disk
#   ✓  a weekly prune of unused images and build cache
#   ✓  unattended security upgrades
#   ✓  fail2ban on sshd
#
#   ✗  it does NOT disable password SSH login unless you pass --harden-ssh, and it refuses even
#      then if the deploy user has no authorized_keys. Locking yourself out of a server you
#      have just paid for is a bad afternoon, and a script that does it silently is worse than
#      one that asks.
#
# ════════════════════════════════════════════════════════════════════════════════════════════
# ABOUT PUTTING THE DEPLOY USER IN THE `docker` GROUP
# ════════════════════════════════════════════════════════════════════════════════════════════
#
# Membership of the docker group is equivalent to root. Not "close to" — equivalent: anyone in
# it can run `docker run -v /:/host` and read or write any file on the machine, with no
# password. This script does it anyway, because the alternative is `sudo` in every deploy over
# SSH, which means either a password prompt no automated deploy can answer or a NOPASSWD sudo
# rule that grants exactly the same thing with more steps.
#
# What follows from that, and it is the whole security posture of this box:
#
#   * the `deploy` user's SSH key IS root on this machine. Treat the GitHub Actions secret
#     holding it accordingly, and give it access to nothing else.
#   * do not use the deploy user for anything but deploying.
#   * if the key is ever exposed, rotate it the same hour: remove it from
#     /home/deploy/.ssh/authorized_keys, generate a new pair, update the repository secret.

set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/varni-dhyan}"
HARDEN_SSH=0
[ "${1:-}" = "--harden-ssh" ] && HARDEN_SSH=1

log()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
command -v apt-get >/dev/null || die "this script is for Debian/Ubuntu"

export DEBIAN_FRONTEND=noninteractive

# ════════════════════════════════════════════════════════════════════════════════════════════
log "1/9  System packages"
# ════════════════════════════════════════════════════════════════════════════════════════════
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl gnupg ufw fail2ban unattended-upgrades git

# ════════════════════════════════════════════════════════════════════════════════════════════
log "2/9  Docker Engine and the compose plugin"
# ════════════════════════════════════════════════════════════════════════════════════════════
#
# From Docker's own repository, not Ubuntu's. Ubuntu ships `docker.io`, which lags and — the
# part that matters here — does not carry the compose V2 plugin, so `docker compose` (no
# hyphen) simply does not exist. Every command in this deployment is written in V2 form.
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl enable --now docker
docker --version
docker compose version

# ════════════════════════════════════════════════════════════════════════════════════════════
log "3/9  Docker daemon: log rotation and a sane default"
# ════════════════════════════════════════════════════════════════════════════════════════════
#
# Docker's default json-file driver has NO size limit. A container that logs steadily will
# eventually fill /var/lib/docker and take the machine down with a disk-full error that looks
# like anything but a logging problem. compose.yaml sets per-container limits as well; this is
# the floor under anything started outside it.
#
# `live-restore` keeps containers running across a daemon restart — an apt upgrade of Docker
# then no longer means the site goes down for the length of the restart.
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
JSON
  systemctl restart docker
else
  warn "/etc/docker/daemon.json already exists — left alone. Check it sets log-opts."
fi

# ════════════════════════════════════════════════════════════════════════════════════════════
log "4/9  The deploy user"
# ════════════════════════════════════════════════════════════════════════════════════════════
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"

install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

# ════════════════════════════════════════════════════════════════════════════════════════════
log "5/9  The deployment directory"
# ════════════════════════════════════════════════════════════════════════════════════════════
install -d -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_DIR"

# ════════════════════════════════════════════════════════════════════════════════════════════
log "6/9  Firewall"
# ════════════════════════════════════════════════════════════════════════════════════════════
#
# Three ports, and the reason each is open:
#   22   SSH. Without it this script's author cannot get back in, and neither can the deploy.
#   80   HTTP. Needed even though everything redirects to HTTPS: Let's Encrypt's http-01
#        challenge arrives on port 80, so closing it means Caddy can never obtain or renew a
#        certificate, and the failure appears roughly sixty days later.
#   443  HTTPS, TCP and UDP. The UDP rule is HTTP/3; drop it and QUIC is simply unavailable.
#
# Nothing else. In particular NOT 8080 — the web container publishes it on 127.0.0.1 only, and
# opening it here would advertise an unencrypted copy of the site on a high port.
#
# ⚠ ufw DOES NOT FILTER PUBLISHED DOCKER PORTS. Docker inserts its own DNAT rules into the nat
#   table, ahead of the INPUT chain ufw builds — so a container published on 0.0.0.0 is
#   reachable from the internet with `ufw status` still reporting that port closed. This
#   deployment's only defence against that is that compose.yaml binds to 127.0.0.1. Keep it
#   that way; the firewall will not save you if it changes.
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    comment 'SSH'
ufw allow 80/tcp    comment 'HTTP - also the ACME http-01 challenge'
ufw allow 443/tcp   comment 'HTTPS'
ufw allow 443/udp   comment 'HTTP/3 (QUIC)'
ufw --force enable
ufw status verbose

# ════════════════════════════════════════════════════════════════════════════════════════════
log "7/9  Automatic security updates"
# ════════════════════════════════════════════════════════════════════════════════════════════
#
# Security patches only, and no automatic reboot: a reboot chosen by a timer is a reboot that
# happens while somebody is mid-દર્શન. `needrestart` reports what wants one; do it deliberately.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
cat > /etc/apt/apt.conf.d/51unattended-upgrades-local <<'CONF'
Unattended-Upgrade::Automatic-Reboot "false";
CONF
systemctl enable --now unattended-upgrades

# ════════════════════════════════════════════════════════════════════════════════════════════
log "8/9  Weekly disk cleanup"
# ════════════════════════════════════════════════════════════════════════════════════════════
#
# Every deploy leaves the image it replaced on the disk, which is exactly what makes
# deploy/rollback.sh instant — so this must NOT be an aggressive prune. `until=168h` keeps a
# week of images, and `-a` is deliberately absent: with it, any image not currently running is
# removed, including the one you would roll back to five minutes later.
#
# Build cache is pruned harder because nothing depends on it: images are built in CI.
cat > /etc/systemd/system/docker-prune.service <<'UNIT'
[Unit]
Description=Prune Docker images and build cache older than a week

[Service]
Type=oneshot
ExecStart=/usr/bin/docker image prune -f --filter until=168h
ExecStart=/usr/bin/docker builder prune -f --filter until=168h
ExecStart=/usr/bin/docker container prune -f --filter until=168h
UNIT

cat > /etc/systemd/system/docker-prune.timer <<'UNIT'
[Unit]
Description=Weekly Docker prune

[Timer]
OnCalendar=Sun 04:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now docker-prune.timer

# ════════════════════════════════════════════════════════════════════════════════════════════
log "9/9  fail2ban on sshd"
# ════════════════════════════════════════════════════════════════════════════════════════════
cat > /etc/fail2ban/jail.d/sshd.local <<'CONF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban

# ════════════════════════════════════════════════════════════════════════════════════════════
if [ "$HARDEN_SSH" -eq 1 ]; then
log "SSH hardening"
# ════════════════════════════════════════════════════════════════════════════════════════════
  if [ ! -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]; then
    die "REFUSING to disable password login: /home/$DEPLOY_USER/.ssh/authorized_keys is empty.
     Add your public key first, from your own machine:
       ssh-copy-id $DEPLOY_USER@YOUR_VPS_IP
     then run this script again with --harden-ssh."
  fi

  cat > /etc/ssh/sshd_config.d/99-varni.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
  # -t first. A malformed sshd config that is loaded anyway is how a server stops accepting
  # connections entirely, with no way in to fix it.
  sshd -t || die "sshd config test failed — /etc/ssh/sshd_config.d/99-varni.conf was NOT applied"
  systemctl reload ssh || systemctl reload sshd

  warn "Password login is now disabled."
  warn "BEFORE CLOSING THIS SESSION, open a second terminal and confirm you can still get in:"
  warn "    ssh $DEPLOY_USER@YOUR_VPS_IP"
fi

# ════════════════════════════════════════════════════════════════════════════════════════════
cat <<EOF

────────────────────────────────────────────────────────────────────────────────
  Ready.

  Next, in order:

  1. Add your SSH public key, and the one GitHub Actions will use:
       nano /home/$DEPLOY_USER/.ssh/authorized_keys

  2. Put the deployment files in place, as $DEPLOY_USER:
       su - $DEPLOY_USER
       git clone <repository-url> $DEPLOY_DIR
       cd $DEPLOY_DIR

  3. Create the environment file and fill it in:
       cp deploy/.env.production.example .env
       chmod 600 .env
       nano .env

  4. Point DNS at this server, and wait for it to resolve:
       dig +short <domain>        # must return $(curl -s --max-time 5 https://api.ipify.org || echo '<this server IP>')

  5. First deploy:
       ./deploy/deploy.sh --local          # or a tag, once CI has pushed one

  6. Check the public origin:
       ./deploy/health-check.sh https://<domain>

  docs/DEPLOYMENT.md has all of this with the reasoning attached.
────────────────────────────────────────────────────────────────────────────────

EOF
