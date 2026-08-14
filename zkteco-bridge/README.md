# zkteco-bridge

Two separate workers, for two different device setups. A given device only ever needs one of them.

## `index.js` — local network devices

For a device that only reaches you over a local network (no internet access, or a customer who
just doesn't want their device exposed to it). Runs on any always-on machine on the **same local
network as the device** — it connects out to the device directly, so it needs to stay powered on
and connected.

### Setup

1. Get this `zkteco-bridge` folder onto that machine (however you like — it's just files, no
   GitHub account needed).
2. Install dependencies:
   ```
   npm install
   ```
3. From the dashboard's **Devices** page, click **"Generate Bridge Credentials"** and download the
   `.env` file it produces. Put that `.env` file in this folder (next to `index.js`).
4. Register the device on the same Devices page with its **local** IP address (e.g.
   `192.168.1.201`) and port (`4370`, the standard ZK port).
5. Start it, and keep it running:
   ```
   npm install -g pm2
   pm2 start index.js --name zkteco-lan
   pm2 save
   ```
   `pm2 save` (plus `pm2 startup` once) makes it survive a reboot of that machine automatically.

Each generated credential is scoped to exactly one company — it can only ever see and write that
company's own data, never any other customer's, even if the `.env` file were leaked. If a machine
is decommissioned or a credential is ever compromised, revoke it from the same Devices page.

## `push-server.js` — cloud-connected devices

For a device configured with its own internet connection and a Cloud Server/ADMS address pointed
at our own server — this is what actually runs there, and is not something a customer ever
installs themselves. See the comments at the top of `push-server.js` for how it works.
