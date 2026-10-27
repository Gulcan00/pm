# Archived: Deploy on Google Cloud Compute Engine

Render with Supabase PostgreSQL is the selected deployment target. See [DEPLOY-RENDER.md](DEPLOY-RENDER.md). This document and `compose.gcp.yaml` are retained as the previous Google Cloud option.

This option keeps the existing Docker app and SQLite database. It is configured for one small Linux VM and a Docker volume on the VM's persistent boot disk; it does not create cloud resources automatically.

## Cost and eligibility

Google Cloud's Always Free Compute Engine allowance currently covers one non-preemptible `e2-micro` instance-month in eligible US regions (`us-west1`, `us-central1`, or `us-east1`), up to 30 GB-month of standard persistent disk, and 1 GB of outbound transfer from North America to destinations other than China and Australia. Confirm the live eligibility rules and regional availability before creating resources. The free tier requires an active billing account and an eligible region.

**This is not guaranteed to be a zero-cost public website.** A public external IPv4 address and outbound traffic beyond the current free allowance can incur charges. The app's AI requests can also incur OpenRouter charges. Google Cloud budgets send alerts; they do not automatically stop every resource that can incur charges. A Free Trial is separate: its $300 credit expires after 90 days, and resources are stopped if the trial ends without upgrading. Always Free quotas and terms can change.

The `e2-micro` has limited memory. Build the Linux container image on a computer with Docker rather than on the VM. The app uses SQLite and is intended for one small instance, not multiple replicas.

The MVP login currently has no failed-attempt throttling. Before exposing it to arbitrary internet traffic, address that finding in [the code review](code_review.md) and use a unique, high-entropy production password. This app is not a hardened public multi-user service.

## Provision the VM

In the Google Cloud Console, using your own account:

1. Create or select a project and ensure its billing status and Free Tier eligibility are understood. Set a billing budget alert before launching resources.
2. Create one Compute Engine VM with machine type `e2-micro`, an Ubuntu LTS image, and a standard persistent boot disk no larger than 30 GB. Select an eligible Free Tier region and a zone in that region. Avoid adding paid GPUs, load balancers, Cloud NAT, premium disks, or other resources.
3. Assign an external IPv4 address so the site can receive public traffic. Google may charge for external IPv4; check current rates in the [network pricing documentation](https://cloud.google.com/vpc/network-pricing) before proceeding.
4. In the VM's VPC firewall rules, permit TCP 22 only from your own IP address, and TCP 80 and 443 from the internet. Do not expose port 8000.
5. Point a DNS `A` record for a hostname you control to the VM's external IP. Wait for DNS to resolve before starting Caddy, which obtains and renews HTTPS certificates automatically.

The browser-based SSH option is described in Google's [SSH documentation](https://cloud.google.com/compute/docs/connect/ssh-in-browser). VM creation, project setup, billing, DNS, and firewall configuration are manual steps in your account.

## Build and transfer the app image

Build from the repository root on a computer with Docker:

```sh
docker build --platform linux/amd64 -t kanban-app:gcp .
docker save kanban-app:gcp -o kanban-app-gcp.tar
```

Configure an OpenSSH public key for the VM as described in Google's [SSH connection guide](https://cloud.google.com/compute/docs/connect/standard-ssh), then copy `kanban-app-gcp.tar` with `scp` (or use another secure file transfer method). The VM's SSH username and external IP are available in the Compute Engine console:

```sh
scp kanban-app-gcp.tar VM_USER@VM_EXTERNAL_IP:~/
```

On the VM, install Docker Engine and the Docker Compose plugin using their official Ubuntu instructions. Then load the transferred image:

```sh
docker load -i ~/kanban-app-gcp.tar
```

Clone or otherwise copy the repository to the VM so it contains `compose.gcp.yaml` and `Caddyfile`. Do not copy a local `.env` file into a public repository or container image.

## Configure secrets and start

From the repository directory on the VM, the following Bash snippet interactively creates a private `.env`. The login password and optional OpenRouter key are entered without echo; the session secret is generated directly into the file and is not printed. Use a unique, high-entropy login password of at least 12 characters using only letters, digits, hyphens, or underscores so it parses safely in the Compose environment file. Leave the OpenRouter key blank if AI is not needed.

```sh
set +x
umask 077
read -r -p "Hostname: " DOMAIN
read -r -s -p "Production login password (12+ characters): " MVP_PASSWORD
printf '\n'
read -r -s -p "OpenRouter API key (blank to disable AI): " OPENROUTER_API_KEY
printf '\n'
SESSION_SECRET="$(openssl rand -hex 32)"
{
  printf 'APP_IMAGE=kanban-app:gcp\n'
  printf 'DOMAIN=%s\n' "$DOMAIN"
  printf 'SESSION_SECRET=%s\n' "$SESSION_SECRET"
  printf 'MVP_PASSWORD=%s\n' "$MVP_PASSWORD"
  printf 'OPENROUTER_API_KEY=%s\n' "$OPENROUTER_API_KEY"
} > .env
chmod 600 .env
unset SESSION_SECRET MVP_PASSWORD OPENROUTER_API_KEY
```

The `.env` selects the image loaded above and is used only by Compose to configure the services. Do not put secret values in commands, shell history, or chat.

Start and verify the services:

```sh
docker compose --env-file .env -f compose.gcp.yaml up -d
docker compose --env-file .env -f compose.gcp.yaml ps
curl --fail https://YOUR_HOSTNAME/api/health
```

Open `https://YOUR_HOSTNAME` and sign in as username `user` with the configured production password. Do not share `.env`, session secrets, or API keys.

## Updates, backup, and shutdown

To update, build a replacement `linux/amd64` image locally with the same tag, transfer it to the VM, load it with `docker load`, and run the Compose `up -d` command again. The SQLite file is stored in the named `kanban-data` Docker volume on the VM. Recreating the container preserves it; deleting the VM with its boot disk does not. Back up the SQLite database regularly and store backups separately.

Inspect service status and logs with:

```sh
docker compose --env-file .env -f compose.gcp.yaml ps
docker compose --env-file .env -f compose.gcp.yaml logs --tail=100
```

Stop the app with:

```sh
docker compose --env-file .env -f compose.gcp.yaml down
```

Stopping containers does **not** stop billing for the VM or its persistent disk; an external IPv4 address can also incur charges. A reserved address can continue to incur charges when not attached to a running VM. When finished with the deployment, back up the database, then delete unneeded billable resources in the Cloud Console and verify that the billing report is clear.

## Official references

- [Google Cloud Free Tier](https://cloud.google.com/free/docs/free-cloud-features)
- [Compute Engine pricing](https://cloud.google.com/compute/pricing)
- [External IP address pricing](https://cloud.google.com/vpc/network-pricing)
- [Cloud Billing budgets](https://cloud.google.com/billing/docs/how-to/budgets)
- [Compute Engine Persistent Disk](https://cloud.google.com/compute/docs/disks/persistent-disks)
