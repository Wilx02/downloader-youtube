import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ytdlp = path.join(root, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const cookies = process.env.YTDLP_COOKIES_FILE || path.join(root, 'cookies.txt');
const downloads = path.join(os.homedir(), 'Downloads', 'NeonTube');

function ok(label, detail = '') {
  console.log(`[OK] ${label}${detail ? `: ${detail}` : ''}`);
}

function warn(label, detail = '') {
  console.log(`[AVISO] ${label}${detail ? `: ${detail}` : ''}`);
}

function fail(label, detail = '') {
  console.log(`[ERRO] ${label}${detail ? `: ${detail}` : ''}`);
}

function exists(file) {
  return file && fs.existsSync(file);
}

console.log('NeonTube doctor\n');

ok('Node.js', process.version);
const nodeMajor = Number(process.versions.node.split('.')[0]);
nodeMajor >= 22 ? ok('runtime JS para yt-dlp EJS', 'node') : warn('Node.js antigo para EJS', 'use Node.js 22+');
exists(ytdlp) ? ok('yt-dlp encontrado', ytdlp) : fail('yt-dlp nao encontrado', 'rode npm install');
exists(ffmpegPath) ? ok('ffmpeg encontrado', ffmpegPath) : fail('ffmpeg nao encontrado', 'rode npm install');

if (!fs.existsSync(downloads)) fs.mkdirSync(downloads, { recursive: true });
ok('pasta de downloads', downloads);

if (exists(cookies)) {
  const size = fs.statSync(cookies).size;
  size > 100 ? ok('cookies.txt encontrado', cookies) : warn('cookies.txt parece vazio', cookies);
} else {
  warn('cookies.txt nao encontrado', 'links que exigem login podem falhar');
}

if (exists(ytdlp)) {
  try {
    const version = execFileSync(ytdlp, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
    ok('versao do yt-dlp', version);
  } catch (error) {
    fail('nao consegui executar yt-dlp', error.message);
  }
}

console.log('\nTeste rapido recomendado:');
console.log('npm run dev');
console.log('http://127.0.0.1:5173/');
