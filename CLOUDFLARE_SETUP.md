# Cloudflare Tunnel Setup Guide

This guide will walk you through deploying your Web Scraper application using Cloudflare Tunnel and Docker.

## Prerequisites

- Docker and Docker Compose installed on your system
- A domain registered with Cloudflare
- Cloudflare account with Zero Trust access

## Step 1: Create Cloudflare Tunnel

### 1.1 Access Cloudflare Dashboard

1. Go to https://dash.cloudflare.com/
2. Log in to your Cloudflare account
3. Navigate to **Zero Trust** (in the left sidebar)
4. Go to **Networks** → **Tunnels**

### 1.2 Create New Tunnel

1. Click **"Create a tunnel"**
2. Select **"Cloudflared"** as the connector type
3. Give your tunnel a name (e.g., `web-scraper-tunnel`)
4. Click **"Save tunnel"**

### 1.3 Copy Tunnel Token

After creating the tunnel, you'll see a command with a long token. The token looks like:
```
eyJhIjoiNzk4M2U3YjYxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQiLCJ0IjoiYWJjZGVmZ2gtMTIzNC01Njc4LTkwMTItYWJjZGVmZ2hpamtsIiwicyI6Ik1USXpORFUyTnpnNU1ERXlNelExTmpjNE9UQXRNVE14TWpFPSJ9
```

**Save this token** - you'll need it in Step 2.

## Step 2: Configure Public Hostname

### 2.1 Add Public Hostname

1. In your tunnel configuration page, click the **"Public Hostname"** tab
2. Click **"Add a public hostname"**

### 2.2 Configure Settings

Fill in the following:

- **Subdomain**: `scraper` (or any name you prefer)
- **Domain**: Select your domain from the dropdown
- **Type**: `HTTP`
- **URL**: `http://scraper:3002`
  - ⚠️ **IMPORTANT**: Use `scraper` (the Docker service name), NOT `localhost`

### 2.3 Enable WebSocket Support

1. Scroll down to **"Additional application settings"**
2. Find the **"WebSocket"** toggle
3. Turn it **ON** (this is critical for the scraper to work)
4. Click **"Save hostname"**

Your public URL will be: `https://scraper.yourdomain.com`

## Step 3: Configure Environment Variables

Add the Cloudflare tunnel token to your `.env` file:

```bash
# Navigate to project directory
cd /home/dell/Web_scraper_v2

# Add the tunnel token (replace with your actual token)
echo "CLOUDFLARE_TUNNEL_TOKEN=your_tunnel_token_here" >> .env
```

Your `.env` file should now contain:
```env
GEMINI_API_KEY=AIzaSyDOaI87_fAUt7tqSuSuShWgeUNoKkhd2T4
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiNzk4M2U3YjYxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQiLCJ0IjoiYWJjZGVmZ2gtMTIzNC01Njc4LTkwMTItYWJjZGVmZ2hpamtsIiwicyI6Ik1USXpORFUyTnpnNU1ERXlNelExTmpjNE9UQXRNVE14TWpFPSJ9
PORT=3002
```

⚠️ **Security Note**: Never commit the `.env` file to Git! It's already in `.gitignore`.

## Step 4: Build and Deploy

### 4.1 Build Docker Image

```bash
docker-compose build
```

This will:
- Install dependencies
- Build the frontend (React + Vite)
- Compile the backend (TypeScript)
- Install Playwright and Chromium
- Create production-ready Docker image

**Expected time**: 5-10 minutes on first build

### 4.2 Start Services

```bash
docker-compose up -d
```

This starts two containers:
- `web-scraper` - Your application
- `cloudflare-tunnel` - Cloudflare tunnel connector

### 4.3 Monitor Startup

Watch the logs to ensure everything starts correctly:

```bash
docker-compose logs -f
```

**What to look for**:
- `web-scraper` logs should show: `Production mode: Serving static files from...`
- `cloudflared` logs should show: `Registered tunnel connection` and `Connection established`

Press `Ctrl+C` to stop following logs (containers keep running).

## Step 5: Verify Deployment

### 5.1 Check Container Health

```bash
docker ps
```

You should see:
- `web-scraper` with status `healthy`
- `cloudflare-tunnel` with status `Up`

### 5.2 Test Local Health Endpoint

```bash
curl http://localhost:3002/health
```

Expected response:
```json
{"status":"ok","sessions":0}
```

### 5.3 Test Public URL

Open your browser and go to:
```
https://scraper.yourdomain.com
```

You should see the Web Scraper interface load.

### 5.4 Test WebSocket Connection

1. Open browser DevTools (F12)
2. Go to the **Network** tab
3. Navigate to the Builder page
4. Click **"New Session"**
5. In the Network tab, look for a connection to `wss://scraper.yourdomain.com/ws`
   - Status should be `101 Switching Protocols`
   - Type should be `websocket`

### 5.5 Test SPA Routing

1. Navigate to different pages (Builder, Reports, Configs)
2. Refresh the page (F5) on each route
3. All pages should load correctly (no 404 errors)

## Step 6: Usage

### Starting Services

```bash
docker-compose up -d
```

### Stopping Services

```bash
docker-compose down
```

### Viewing Logs

```bash
# All services
docker-compose logs -f

# Just the scraper
docker-compose logs -f scraper

# Just cloudflared
docker-compose logs -f cloudflared
```

### Rebuilding After Code Changes

```bash
docker-compose up -d --build
```

### Checking Service Status

```bash
docker ps
```

### Restarting a Service

```bash
# Restart scraper
docker-compose restart scraper

# Restart cloudflared
docker-compose restart cloudflared
```

## Troubleshooting

### Issue: Cloudflared Not Connecting

**Symptoms**: `cloudflared` logs show connection errors

**Solutions**:
1. Verify `CLOUDFLARE_TUNNEL_TOKEN` in `.env` is correct
2. Check scraper service is healthy: `docker ps`
3. Ensure tunnel exists in Cloudflare dashboard
4. Restart cloudflared: `docker-compose restart cloudflared`

### Issue: WebSocket Connection Failed

**Symptoms**: Browser console shows WebSocket errors

**Solutions**:
1. Verify WebSocket is enabled in Cloudflare tunnel config
2. Check URL is `wss://` (not `ws://`)
3. Check cloudflared logs for connection issues
4. Test health endpoint: `curl https://scraper.yourdomain.com/health`

### Issue: 404 on SPA Routes

**Symptoms**: Refreshing `/builder` or `/reports` returns 404

**Solutions**:
1. Verify `NODE_ENV=production` is set in docker-compose.yml
2. Check scraper logs for "Production mode: Serving static files"
3. Rebuild: `docker-compose up -d --build`

### Issue: Chromium Crashes

**Symptoms**: Browser sessions fail to start

**Solutions**:
1. Increase shared memory: Edit `shm_size: 2gb` in docker-compose.yml
2. Check memory limits: Ensure at least 2GB RAM available
3. View logs: `docker-compose logs scraper`

### Issue: Build Fails

**Symptoms**: `docker-compose build` fails

**Solutions**:
1. Check `npm run build` works locally
2. Ensure `package.json` and `package-lock.json` are committed
3. Clear Docker cache: `docker system prune -a`
4. Check disk space: `df -h`

### Viewing Container Resource Usage

```bash
docker stats web-scraper
```

### Accessing Container Shell

```bash
docker exec -it web-scraper /bin/bash
```

## Security Recommendations

### 1. Add Cloudflare Access (Recommended)

Protect your application with authentication:

1. Go to Cloudflare Zero Trust → Access → Applications
2. Click "Add an application"
3. Select "Self-hosted"
4. Configure:
   - Application name: `Web Scraper`
   - Domain: `scraper.yourdomain.com`
   - Session duration: `24 hours`
5. Add authentication rules:
   - Example: Email ends with `@yourdomain.com`
   - Or: Specific email addresses
6. Save

Now users must authenticate before accessing the app.

### 2. Environment Variable Security

- Never commit `.env` to Git
- Use strong, unique tokens
- Rotate tokens periodically
- Consider using Docker secrets for production

### 3. Regular Updates

```bash
# Update Docker images
docker-compose pull
docker-compose up -d --build

# Update dependencies
npm update
docker-compose up -d --build
```

## Maintenance

### Backup Configurations

Your scraper configurations are stored in `./configs/`:

```bash
# Create backup
tar -czf configs-backup-$(date +%Y%m%d).tar.gz configs/

# Restore backup
tar -xzf configs-backup-20240102.tar.gz
```

### View Disk Usage

```bash
# Docker disk usage
docker system df

# Container sizes
docker ps -s
```

### Clean Up

```bash
# Remove stopped containers
docker container prune

# Remove unused images
docker image prune -a

# Remove all unused resources
docker system prune -a --volumes
```

## Advanced Configuration

### Custom Resource Limits

Edit `docker-compose.yml` to adjust resources:

```yaml
deploy:
  resources:
    limits:
      memory: 8G      # Increase for heavy workloads
      cpus: '4'       # More CPUs for parallel scraping
    reservations:
      memory: 4G
      cpus: '2'
```

### Custom Port

To change the port:

1. Edit `PORT=3002` in `.env`
2. Update `expose` in Dockerfile
3. Update `ports` in docker-compose.yml (if mapping)
4. Update URL in Cloudflare tunnel config

### Auto-Start on Server Reboot

Docker Compose services are set to `restart: unless-stopped`, so they'll auto-start on reboot.

To ensure Docker itself starts on boot:

```bash
sudo systemctl enable docker
```

## Support

If you encounter issues:

1. Check logs: `docker-compose logs -f`
2. Verify Cloudflare tunnel status in dashboard
3. Test health endpoint: `curl https://scraper.yourdomain.com/health`
4. Review this troubleshooting guide

## Summary

You've successfully deployed your Web Scraper with:
- ✅ Dockerized application (isolated environment)
- ✅ Cloudflare Tunnel (secure, no port forwarding needed)
- ✅ WebSocket support (real-time browser streaming)
- ✅ Persistent configurations (survive container restarts)
- ✅ Production-ready setup (health checks, auto-restart)

Your app is now accessible at: `https://scraper.yourdomain.com`
