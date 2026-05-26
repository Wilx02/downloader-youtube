import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binDir = path.join(root, 'bin');
const binPath = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const url = process.platform === 'win32'
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

const force = process.argv.includes('--force');

if (!force && fs.existsSync(binPath) && fs.statSync(binPath).size > 1024 * 1024) {
  console.log(`yt-dlp already available at ${binPath}`);
  process.exit(0);
}

fs.mkdirSync(binDir, { recursive: true });

function download(source, destination, redirects = 0) {
  if (redirects > 5) throw new Error('Too many redirects while downloading yt-dlp.');

  return new Promise((resolve, reject) => {
    https.get(source, { headers: { 'User-Agent': 'NeonTube-Downloader' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        resolve(download(new URL(response.headers.location, source).toString(), destination, redirects + 1));
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`yt-dlp download failed with HTTP ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(destination, { mode: 0o755 });
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

console.log('Downloading yt-dlp...');
await download(url, binPath);
console.log(`yt-dlp ready at ${binPath}`);
