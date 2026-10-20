# Deploy on OCI Always Free

This deployment keeps the app on SQLite and stores its database in a persistent Docker volume on an Oracle Cloud Infrastructure (OCI) Compute VM. Caddy terminates HTTPS automatically. OCI Always Free capacity is not guaranteed, and Oracle may reclaim Always Free compute instances that remain below its published CPU, network, and memory utilization thresholds for seven days. A custom hostname is required for trusted HTTPS.

## Create the VM

1. Create an OCI Free Tier account and choose the home region carefully. OCI currently requires a payment card for account verification; Always Free usage remains limited to eligible resources. Check the current [Always Free resource limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) and compute capacity before creating resources.
2. Create an Ubuntu 24.04 VM using the `VM.Standard.A1.Flex` shape. Keep the combined allocation within the current Always Free allowance: up to 2 OCPUs and 12 GB RAM. The boot volume counts toward the shared Always Free block-storage allowance.
3. Use a public subnet and assign a public IPv4 address. In the VCN security list or network security group, allow inbound TCP 22 only from your own IP, plus TCP 80 and 443 from the internet. Do not open port 8000.
4. Create an `A` DNS record for a hostname you control that points to the VM's public IPv4 address. Wait for DNS to resolve before starting Caddy.

## Install and Configure

Connect over SSH, then install Docker Compose and Git:

```sh
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and reconnect so the Docker group membership takes effect. Then clone the repository and prepare the server-only environment file:

```sh
git clone <repository-url> pm
cd pm
umask 077
nano .env
```

Set these values in `.env`; generate the session secret on the VM with `openssl rand -hex 32`. Do not commit or paste secrets into chat.

```dotenv
DOMAIN=kanban.example.com
SESSION_SECRET=<unique-random-value-at-least-32-characters>
MVP_PASSWORD=<unique-password-at-least-12-characters>
OPENROUTER_API_KEY=<optional-openrouter-key>
```

Restrict the file and build/start the app:

```sh
chmod 600 .env
docker compose --env-file .env -f compose.oci.yaml up -d --build
```

Open `https://<your-hostname>` and sign in as username `user` with the configured `MVP_PASSWORD`. Verify the health endpoint:

```sh
curl --fail https://<your-hostname>/api/health
```

## Operations

- Check service status and logs with `docker compose --env-file .env -f compose.oci.yaml ps` and `docker compose --env-file .env -f compose.oci.yaml logs --tail=100`.
- Update by pulling the desired revision and rerunning the `up -d --build` command. The `kanban-data` volume persists the SQLite database across container rebuilds.
- Back up the database regularly. Stop the app before copying its SQLite file, and store backups outside the VM. A persistent volume is not a backup.
- Keep OCI security rules limited to SSH from your IP and public HTTP/HTTPS. The application container is not published directly.
- Monitor OCI usage and billing. Stay within Always Free resource limits; remove any resources the Console marks as paid before the trial ends.

OCI account creation, VM provisioning, DNS, and secret entry must be performed in the user's own accounts. The repository configuration does not provision cloud resources automatically.