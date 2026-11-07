// Desktop shell: serves the built game from a tiny local HTTP server inside the app and opens it in a window.
const { app, BrowserWindow, Menu } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webp': 'image/webp', '.ico': 'image/x-icon' };

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// ANGLE's default D3D11 backend crashes the GPU process on some AMD drivers (falls back to slow software WebGL); OpenGL is stable.
app.commandLine.appendSwitch('use-angle', 'gl');

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, path.normalize(p).replace(/^([\/])+/, ''));
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const port = await serve();
  const win = new BrowserWindow({ width: 1600, height: 900, backgroundColor: '#000000', title: 'Technoblade - The Blood God', autoHideMenuBar: true, webPreferences: { backgroundThrottling: false } });
  win.maximize();
  win.loadURL(`http://127.0.0.1:${port}/`);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
});
app.on('window-all-closed', () => app.quit());
