import express, { Request, Response } from 'express';
import { Storage } from '@google-cloud/storage';
import mime from 'mime-types';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 8080;

// Environment configuration
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'axiom-docs-development';
const PLATFORM_URL = process.env.HELICARRIER_PLATFORM_URL || 'https://helicarrier-dev.zingworks.com';

// Initialize GCS client
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

// Middleware: Parse JSON
app.use(express.json());

// Health check endpoint (unauthenticated)
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', bucket: BUCKET_NAME });
});

// Serve the Helicarrier SDK IIFE browser bundle
app.get('/sdk/helicarrier.js', (_req: Request, res: Response) => {
  res.sendFile(
    path.resolve(__dirname, '../node_modules/@helicarrier/sdk/dist/browser/helicarrier.global.js')
  );
});

// Platform integration script + Back to Portal button (injected into all HTML pages)
const PLATFORM_SCRIPT = `
<style>
  .codex-back-btn {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    transition: all 0.2s ease;
    text-decoration: none;
  }
  .codex-back-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(102, 126, 234, 0.5);
  }
  .codex-back-btn svg {
    width: 16px;
    height: 16px;
  }
</style>
<script src="/sdk/helicarrier.js"></script>
<script>
(function() {
  // Add Back to Portal button (only if not on portal page)
  var isPortal = window.location.pathname === '/' || window.location.pathname === '/index.html';
  if (!isPortal) {
    var btn = document.createElement('a');
    btn.href = '/';
    btn.className = 'codex-back-btn';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Back to Portal';
    document.body.appendChild(btn);
  }

  // Initialize Helicarrier SDK (handles APP_READY, SESSION_INIT, auth, diagnostics, auto-capture)
  if (window.Helicarrier && window.Helicarrier.HelicarrierClient) {
    var client = new Helicarrier.HelicarrierClient({
      platformOrigin: '${PLATFORM_URL}'
    });
    client.init();
    console.log('[Codex] Helicarrier SDK initialized');
  }
})();
</script>
`;

// Catalog cache
let catalogCache: { data: any[] | null; expiry: number } = { data: null, expiry: 0 };
const CATALOG_TTL = 5 * 60 * 1000; // 5 minutes
const ACCENT_PALETTE = ['#a371f7', '#3fb950', '#f97316', '#3b82f6', '#ef4444', '#eab308'];

function titleCase(str: string): string {
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Auto-discovery catalog endpoint
app.get('/api/catalog', async (_req: Request, res: Response) => {
  try {
    // Return cached if valid
    if (catalogCache.data && Date.now() < catalogCache.expiry) {
      return res.json(catalogCache.data);
    }

    // List top-level "folders" using delimiter
    const [, , apiResponse] = await bucket.getFiles({ delimiter: '/' });
    const prefixes: string[] = (apiResponse as any)?.prefixes || [];

    const libraries: any[] = [];
    let accentIndex = 0;

    for (const prefix of prefixes) {
      const folderName = prefix.replace(/\/$/, '');

      // Skip internal/hidden folders
      if (folderName.startsWith('_') || folderName.startsWith('.')) {
        continue;
      }

      // Check that folder has an index.html (or any .html entry point)
      const indexFile = bucket.file(`${folderName}/index.html`);
      const [indexExists] = await indexFile.exists();
      let docsUrl = `/${folderName}/index.html`;

      if (!indexExists) {
        const [files] = await bucket.getFiles({ prefix: `${folderName}/`, delimiter: '/', maxResults: 20 });
        const htmlFile = files.find((f: { name: string }) => f.name.endsWith('.html'));
        if (!htmlFile) continue;
        docsUrl = `/${htmlFile.name}`;
      }

      // Try to load optional catalog.json
      let metadata: any = {};
      try {
        const catalogFile = bucket.file(`${folderName}/catalog.json`);
        const [catalogExists] = await catalogFile.exists();
        if (catalogExists) {
          const [content] = await catalogFile.download();
          metadata = JSON.parse(content.toString('utf-8'));
        }
      } catch (e) {
        // catalog.json missing or invalid — use defaults
      }

      libraries.push({
        id: folderName,
        title: metadata.title || titleCase(folderName),
        description: metadata.description || 'Documentation',
        category: metadata.category || 'Documentation',
        icon: metadata.icon || '📖',
        version: metadata.version || '',
        downloads: '—',
        accent: metadata.accent || ACCENT_PALETTE[accentIndex % ACCENT_PALETTE.length],
        docsUrl: metadata.docsUrl || docsUrl
      });

      accentIndex++;
    }

    // Cache results
    catalogCache = { data: libraries, expiry: Date.now() + CATALOG_TTL };
    console.log(`[CATALOG] Discovered ${libraries.length} doc sets: ${libraries.map(l => l.id).join(', ')}`);

    return res.json(libraries);
  } catch (error) {
    console.error('[CATALOG] Error:', error);
    return res.status(500).json({ error: 'Failed to load catalog' });
  }
});

// Stub: SDK calls this to init app session — Codex is stateless, just acknowledge
app.post('/api/app_session/init', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Static docs app — no session required' });
});

// Serve all content from GCS (Platform handles auth via iframe access)
app.get('*', async (req: Request, res: Response) => {
  try {
    // Get path from request (remove leading slash)
    let filePath = req.path.substring(1) || 'index.html';

    // Handle directory requests - add index.html
    if (!path.extname(filePath)) {
      filePath = filePath.endsWith('/') ? filePath + 'index.html' : filePath + '/index.html';
    }

    // Clean up double slashes
    filePath = filePath.replace(/\/+/g, '/');

    console.log(`[GCS] Requested: ${req.path} -> ${filePath}`);

    const file = bucket.file(filePath);
    const [exists] = await file.exists();

    if (!exists) {
      // Try without trailing /index.html for root requests
      if (filePath === '/index.html' || filePath === 'index.html') {
        console.log(`[GCS] File not found: ${filePath}`);
        return res.status(404).send('Not found');
      }

      // Try the path as-is (without added index.html)
      const altPath = req.path.substring(1);
      if (altPath && altPath !== filePath) {
        const altFile = bucket.file(altPath);
        const [altExists] = await altFile.exists();
        if (altExists) {
          filePath = altPath;
        } else {
          console.log(`[GCS] File not found: ${filePath} (also tried: ${altPath})`);
          return res.status(404).send('Not found');
        }
      } else {
        console.log(`[GCS] File not found: ${filePath}`);
        return res.status(404).send('Not found');
      }
    }

    // Get content type
    const contentType = mime.lookup(filePath) || 'application/octet-stream';
    const isHtml = contentType === 'text/html';

    if (isHtml) {
      // For HTML files: inject Platform script
      const [content] = await file.download();
      let html = content.toString('utf-8');

      // Inject script before </body> or at end
      if (html.includes('</body>')) {
        html = html.replace('</body>', PLATFORM_SCRIPT + '</body>');
      } else {
        html = html + PLATFORM_SCRIPT;
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    } else {
      // For non-HTML files: stream directly
      res.setHeader('Content-Type', contentType);
      const fileToStream = bucket.file(filePath);
      fileToStream.createReadStream()
        .on('error', (err) => {
          console.error(`[GCS] Stream error for ${filePath}:`, err);
          res.status(500).send('Error reading file');
        })
        .pipe(res);
    }

  } catch (error) {
    console.error('[GCS] Error:', error);
    res.status(500).send('Internal server error');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`[SERVER] Axiom Docs running on port ${PORT}`);
  console.log(`[CONFIG] Bucket: ${BUCKET_NAME}`);
  console.log(`[CONFIG] Platform: ${PLATFORM_URL}`);
});
