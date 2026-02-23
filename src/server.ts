import express, { Request, Response, NextFunction } from 'express';
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

// Simple in-memory session store (for production, use Redis or similar)
const validSessions = new Map<string, { email: string; expiresAt: number }>();

// Middleware: Parse JSON
app.use(express.json());

// Health check endpoint (unauthenticated)
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', bucket: BUCKET_NAME });
});

// Session initialization endpoint - called by client after SDK auth
app.post('/api/session/init', (req: Request, res: Response) => {
  const { email, token } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  // Generate session ID
  const sessionId = generateSessionId();
  const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

  // Store session
  validSessions.set(sessionId, { email, expiresAt });

  // Set session cookie
  res.cookie('axiom_session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'none', // Required for iframe
    maxAge: 24 * 60 * 60 * 1000
  });

  console.log(`[AUTH] Session created for ${email}`);
  return res.json({ success: true, email });
});

// Session check endpoint
app.get('/api/session/check', (req: Request, res: Response) => {
  const sessionId = extractSessionId(req);

  if (!sessionId) {
    return res.json({ authenticated: false });
  }

  const session = validSessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    validSessions.delete(sessionId);
    return res.json({ authenticated: false });
  }

  return res.json({ authenticated: true, email: session.email });
});

// Auth middleware for docs
const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  // Allow auth pages without session
  if (req.path === '/' || req.path === '/auth.html') {
    return next();
  }

  const sessionId = extractSessionId(req);

  if (!sessionId) {
    console.log(`[AUTH] No session - redirecting to auth`);
    return res.redirect('/');
  }

  const session = validSessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    validSessions.delete(sessionId);
    console.log(`[AUTH] Invalid/expired session - redirecting to auth`);
    return res.redirect('/');
  }

  next();
};

// Health check (must be before wildcard route)
// Already defined above

// API routes (must be before wildcard route)
// Already defined above

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
<script>
(function() {
  var sessionEstablished = false;

  // Add Back to Portal button (only if not on portal page)
  var isPortal = window.location.pathname === '/' || window.location.pathname === '/index.html';
  if (!isPortal) {
    var btn = document.createElement('a');
    btn.href = '/';
    btn.className = 'codex-back-btn';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Back to Portal';
    document.body.appendChild(btn);
  }

  // Listen for messages from Platform
  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data || !data.type) return;

    console.log('[Codex] Received message:', data.type);

    switch (data.type) {
      case 'SESSION_INIT':
        // Platform is initializing session - acknowledge with SESSION_READY
        if (window.parent !== window) {
          window.parent.postMessage({
            type: 'SESSION_READY',
            payload: { success: true }
          }, '*');
          sessionEstablished = true;
          console.log('[Codex] SESSION_READY sent');
        }
        break;

      case 'SESSION_DATA':
        // Platform sent session data - acknowledge
        if (window.parent !== window) {
          window.parent.postMessage({
            type: 'SESSION_RECEIVED',
            payload: { success: true }
          }, '*');
          console.log('[Codex] SESSION_RECEIVED sent');
        }
        break;

      case 'PING':
        // Respond to ping
        if (window.parent !== window) {
          window.parent.postMessage({ type: 'PONG' }, '*');
        }
        break;
    }
  });

  // Send APP_READY to Platform parent
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'APP_READY' }, '*');
    console.log('[Codex] APP_READY sent');
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

// Helper: Generate session ID
function generateSessionId(): string {
  return Array.from({ length: 32 }, () =>
    Math.random().toString(36).charAt(2)
  ).join('');
}

// Helper: Extract session ID from cookie
function extractSessionId(req: Request): string | null {
  const cookies = req.headers.cookie?.split(';') || [];
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'axiom_session') {
      return value;
    }
  }
  return null;
}

// Simple loader page - sends APP_READY and loads docs
function getLoaderPageHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Infinity Codex</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #f5f5f5;
    }
    .container { text-align: center; padding: 2rem; }
    .spinner {
      width: 40px; height: 40px;
      border: 3px solid #e0e0e0;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 1rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .status { color: #666; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h2>Infinity Codex</h2>
    <p class="status">Loading documentation...</p>
  </div>
  <script>
    // Send APP_READY to Platform immediately
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'APP_READY' }, '*');
      console.log('[Codex] APP_READY sent');
    }
    // Redirect to docs
    window.location.href = '/docs/index.html';
  </script>
</body>
</html>`;
}

// Start server
app.listen(PORT, () => {
  console.log(`[SERVER] Axiom Docs running on port ${PORT}`);
  console.log(`[CONFIG] Bucket: ${BUCKET_NAME}`);
  console.log(`[CONFIG] Platform: ${PLATFORM_URL}`);
});
