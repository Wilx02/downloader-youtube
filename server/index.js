import cors from 'cors';
import express from 'express';
import ffmpegPath from 'ffmpeg-static';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 4317;
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const YTDLP_PATH = path.join(ROOT_DIR, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'NeonTube');
const EJS_OPTIONS = {
  jsRuntimes: 'node',
  remoteComponents: 'ejs:github'
};
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const jobs = new Map();
const execFileAsync = promisify(execFile);

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function isLikelyYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'].includes(url.hostname);
  } catch {
    return false;
  }
}

function normalizeYouTubeUrl(value, playlist = false) {
  const url = new URL(value);
  if (url.hostname === 'youtu.be') {
    const id = url.pathname.replace('/', '');
    return `https://www.youtube.com/watch?v=${id}`;
  }

  if (!playlist) {
    url.searchParams.delete('list');
    url.searchParams.delete('start_radio');
    url.searchParams.delete('index');
    url.searchParams.delete('pp');
  }

  return url.toString();
}

function browserExists(browser) {
  const candidates = {
    edge: [
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ],
    chrome: [
      path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ],
    firefox: [
      path.join(process.env.PROGRAMFILES || '', 'Mozilla Firefox', 'firefox.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Mozilla Firefox', 'firefox.exe')
    ]
  };
  return candidates[browser]?.some((candidate) => candidate && fs.existsSync(candidate));
}

function preferredCookiesBrowser() {
  if (process.env.YTDLP_COOKIES_BROWSER) return process.env.YTDLP_COOKIES_BROWSER;
  return ['edge', 'chrome', 'firefox'].find(browserExists) || null;
}

function availableCookiesBrowsers() {
  if (process.env.YTDLP_COOKIES_BROWSER) return [process.env.YTDLP_COOKIES_BROWSER];
  return ['edge', 'chrome', 'firefox'].filter(browserExists);
}

function cookiesFilePath() {
  const customPath = process.env.YTDLP_COOKIES_FILE;
  if (customPath && fs.existsSync(customPath)) return customPath;

  const projectPath = path.join(ROOT_DIR, 'cookies.txt');
  if (fs.existsSync(projectPath)) return projectPath;

  return null;
}

function addCookieSource(flags = {}) {
  const filePath = cookiesFilePath();
  if (filePath) return { ...flags, cookies: filePath };

  const browser = preferredCookiesBrowser();
  if (browser) return { ...flags, cookiesFromBrowser: browser };

  return flags;
}

function secondsToClock(total = 0) {
  const seconds = Math.max(0, Math.round(total));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function bestThumbnail(info) {
  if (info.thumbnail) return info.thumbnail;
  const thumbnails = Array.isArray(info.thumbnails) ? info.thumbnails : [];
  return thumbnails.at(-1)?.url || '';
}

function formatBytes(value) {
  if (!value || Number.isNaN(value)) return null;
  return Math.round(value);
}

function buildProfiles(info) {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const videoFormats = formats
    .filter((format) => format.vcodec && format.vcodec !== 'none' && format.height)
    .map((format) => ({
      height: format.height,
      ext: format.ext,
      fps: format.fps || null,
      bytes: formatBytes(format.filesize || format.filesize_approx),
      hasAudio: Boolean(format.acodec && format.acodec !== 'none'),
      note: format.format_note || ''
    }));
  const audioFormats = formats
    .filter((format) => format.acodec && format.acodec !== 'none' && (!format.vcodec || format.vcodec === 'none'))
    .map((format) => formatBytes(format.filesize || format.filesize_approx))
    .filter(Boolean);

  const bestAudioBytes = audioFormats.length ? Math.max(...audioFormats) : null;
  const mp3Estimate = info.duration ? Math.round((192000 / 8) * info.duration) : bestAudioBytes;
  const qualities = [
    { label: '360p', height: 360 },
    { label: '480p', height: 480 },
    { label: '720p', height: 720 },
    { label: '1080p', height: 1080 },
    { label: '1440p', height: 1440 },
    { label: '4K', height: 2160 }
  ].map((quality) => {
    const candidates = videoFormats.filter((format) => format.height <= quality.height);
    const exact = videoFormats.filter((format) => format.height === quality.height);
    const best = (exact.length ? exact : candidates).sort((a, b) => (b.bytes || 0) - (a.bytes || 0))[0];
    const videoBytes = best?.bytes || null;
    return {
      ...quality,
      available: exact.length > 0,
      fallbackAvailable: Boolean(best),
      estimated: {
        withAudio: videoBytes && bestAudioBytes ? videoBytes + bestAudioBytes : videoBytes,
        videoOnly: videoBytes,
        audioMp3: mp3Estimate
      }
    };
  });

  const maxHeight = Math.max(0, ...videoFormats.map((format) => format.height));
  return { qualities, maxHeight, audioBytes: bestAudioBytes, formats: videoFormats };
}

function flagName(key) {
  return `--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

function toArgs(url, flags = {}) {
  const args = [url];
  for (const [key, value] of Object.entries(flags)) {
    if (value === false || value === undefined || value === null) continue;
    const flag = flagName(key);
    if (value === true) {
      args.push(flag);
    } else {
      args.push(flag, String(value));
    }
  }
  return args;
}

async function runYtdlpJson(url, flags) {
  if (!fs.existsSync(YTDLP_PATH)) {
    throw new Error('yt-dlp.exe nao encontrado. Rode npm install novamente.');
  }
  const { stdout } = await execFileAsync(YTDLP_PATH, toArgs(url, flags), {
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

async function runYtdlpJsonWithFallback(url, flags) {
  try {
    return await runYtdlpJson(url, flags);
  } catch (error) {
    const message = `${error.stderr || ''}\n${error.message || ''}`;
    const filePath = cookiesFilePath();
    if (filePath && !flags.cookies) {
      try {
        return await runYtdlpJson(url, { ...flags, cookies: filePath });
      } catch (cookieFileError) {
        error.cookieErrors = [`cookies.txt: ${cookieFileError.stderr || cookieFileError.message || 'falhou'}`];
      }
    }

    const browsers = availableCookiesBrowsers();
    if (!browsers.length || !/not a bot|sign in|cookies/i.test(message)) throw error;

    const cookieErrors = error.cookieErrors || [];
    for (const browser of browsers) {
      try {
        return await runYtdlpJson(url, { ...flags, cookiesFromBrowser: browser });
      } catch (cookieError) {
        cookieErrors.push(`${browser}: ${cookieError.stderr || cookieError.message || 'falhou'}`);
      }
    }

    error.cookieErrors = cookieErrors;
    throw error;
  }
}

function spawnYtdlp(url, flags) {
  if (!fs.existsSync(YTDLP_PATH)) {
    throw new Error('yt-dlp.exe nao encontrado. Rode npm install novamente.');
  }
  return spawn(YTDLP_PATH, toArgs(url, flags), {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

function parseProgress(line) {
  const percent = line.match(/\[download\]\s+([\d.]+)%/i)?.[1];
  const speed = line.match(/at\s+(.+?)\s+ETA/i)?.[1];
  const eta = line.match(/ETA\s+([0-9:]+)/i)?.[1];
  const total = line.match(/of\s+~?\s*([^\s]+)\s+at/i)?.[1] || line.match(/of\s+~?\s*([^\s]+)/i)?.[1];
  return percent ? { percent: Number(percent), speed: speed || '', eta: eta || '', total: total || '' } : null;
}

function buildYtdlpOptions({ quality, mode, container, subtitles, playlist }) {
  const height = quality === 'best' ? null : Number(quality);
  const output = path.join(DOWNLOAD_DIR, '%(title).180B [%(id)s].%(ext)s');
  const common = {
    output,
    restrictFilenames: true,
    noWarnings: true,
    newline: true,
    progress: true,
    yesPlaylist: Boolean(playlist),
    noPlaylist: !playlist,
    ...EJS_OPTIONS
  };

  Object.assign(common, addCookieSource());
  if (ffmpegPath) common.ffmpegLocation = ffmpegPath;
  if (subtitles) {
    common.writeSub = true;
    common.writeAutoSub = true;
    common.subLang = 'pt,en';
    common.convertSubs = 'srt';
  }

  if (mode === 'audio') {
    return {
      ...common,
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 0,
      format: 'bestaudio/best'
    };
  }

  const cap = height ? `[height<=${height}]` : '';
  if (mode === 'video-only') {
    return {
      ...common,
      format: `bestvideo${cap}/best${cap}`,
      mergeOutputFormat: container === 'webm' ? 'webm' : 'mp4'
    };
  }

  return {
    ...common,
    format: `bestvideo${cap}+bestaudio/best${cap}/best`,
    mergeOutputFormat: container === 'webm' ? 'webm' : 'mp4'
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, downloadDir: DOWNLOAD_DIR });
});

app.post('/api/analyze', async (req, res) => {
  const { url, playlist = false } = req.body || {};
  if (!url || !isLikelyYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Cole um link valido do YouTube.' });
  }

  try {
    const normalizedUrl = normalizeYouTubeUrl(url, playlist);
    const info = await runYtdlpJsonWithFallback(normalizedUrl, {
      dumpSingleJson: true,
      skipDownload: true,
      noWarnings: true,
      noPlaylist: !playlist,
      yesPlaylist: Boolean(playlist),
      ...EJS_OPTIONS
    });

    const playlistItems = Array.isArray(info.entries) ? info.entries.length : 0;
    const source = playlistItems ? info.entries.find(Boolean) || info : info;
    const profiles = buildProfiles(source);
    res.json({
      id: source.id,
      title: info.title || source.title || 'Video do YouTube',
      thumbnail: bestThumbnail(source),
      duration: source.duration || null,
      durationLabel: source.duration ? secondsToClock(source.duration) : 'Playlist',
      webpageUrl: source.webpage_url || normalizedUrl,
      playlistItems,
      ...profiles
    });
  } catch (error) {
    const details = `${error.stderr || ''}\n${error.message || ''}\n${(error.cookieErrors || []).join('\n')}`;
    if (/cookie|DPAPI|decrypt/i.test(details)) {
      return res.status(422).json({
        error: 'Nao consegui ler os cookies do navegador. Coloque um cookies.txt valido na raiz do projeto ou feche Chrome/Edge completamente e tente de novo.'
      });
    }
    if (/not a bot|sign in/i.test(details)) {
      return res.status(422).json({
        error: 'O YouTube pediu confirmacao de login. Use um cookies.txt exportado da sua conta ou rode com YTDLP_COOKIES_BROWSER=chrome/edge/firefox.'
      });
    }
    res.status(422).json({ error: 'Nao foi possivel analisar este link. Verifique a URL ou tente novamente.' });
  }
});

app.post('/api/downloads', async (req, res) => {
  const { url, quality = 'best', mode = 'video-audio', container = 'mp4', subtitles = false, playlist = false, title = '' } = req.body || {};
  if (!url || !isLikelyYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Cole um link valido do YouTube.' });
  }

  const jobId = crypto.randomUUID();
  const normalizedUrl = normalizeYouTubeUrl(url, playlist);
  const options = buildYtdlpOptions({ quality, mode, container, subtitles, playlist });
  let child;
  try {
    child = spawnYtdlp(normalizedUrl, options);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
  jobs.set(jobId, { child, startedAt: Date.now(), title });
  res.status(202).json({ jobId, downloadDir: DOWNLOAD_DIR });

  broadcast({ type: 'started', jobId, title, downloadDir: DOWNLOAD_DIR });

  child.stdout?.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
      const progress = parseProgress(line);
      if (progress) broadcast({ type: 'progress', jobId, ...progress });
      if (line.includes('[ExtractAudio]') || line.includes('[Merger]') || line.includes('[SubtitlesConvertor]')) {
        broadcast({ type: 'processing', jobId, message: line.replace(/^\[[^\]]+\]\s*/, '') });
      }
      if (line.includes('Destination:') || line.includes('Merging formats into')) {
        broadcast({ type: 'file', jobId, message: line.trim() });
      }
    }
  });

  child.stderr?.on('data', (chunk) => {
    const message = chunk.toString().trim();
    if (message) {
      const job = jobs.get(jobId);
      if (job) job.lastError = message;
      broadcast({ type: 'log', jobId, message });
    }
  });

  child.on('close', (code) => {
    const job = jobs.get(jobId);
    jobs.delete(jobId);
    if (code === 0) {
      broadcast({ type: 'complete', jobId, percent: 100, downloadDir: DOWNLOAD_DIR });
    } else {
      const error = code === null ? 'Download cancelado.' : job?.lastError || 'O download falhou antes de terminar.';
      broadcast({ type: 'error', jobId, error });
    }
  });
});

app.post('/api/downloads/:jobId/cancel', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Download nao encontrado.' });
  job.child.kill('SIGTERM');
  jobs.delete(req.params.jobId);
  broadcast({ type: 'cancelled', jobId: req.params.jobId });
  res.json({ ok: true });
});

server.listen(PORT, () => {
  console.log(`NeonTube API on http://127.0.0.1:${PORT}`);
  console.log(`Downloads: ${DOWNLOAD_DIR}`);
});
