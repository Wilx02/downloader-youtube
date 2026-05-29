import {
  Activity,
  Captions,
  Check,
  Clock3,
  Download,
  FileAudio,
  FileVideo,
  Gauge,
  History,
  Images,
  Link2,
  Loader2,
  Music2,
  PauseCircle,
  Play,
  Radio,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Video,
  Youtube
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const qualityOptions = [
  { label: 'Melhor', value: 'best' },
  { label: '360p', value: '360' },
  { label: '480p', value: '480' },
  { label: '720p', value: '720' },
  { label: '1080p', value: '1080' },
  { label: '1440p', value: '1440' },
  { label: '4K', value: '2160' }
];

const modeOptions = [
  { label: 'Vídeo + áudio', value: 'video-audio', icon: FileVideo },
  { label: 'Sem áudio', value: 'video-only', icon: Video },
  { label: 'MP3', value: 'audio', icon: FileAudio }
];

const platformOptions = [
  { label: 'YouTube', value: 'youtube', icon: Youtube, placeholder: 'Cole aqui o link do YouTube' },
  { label: 'Pinterest', value: 'pinterest', icon: Images, placeholder: 'Cole aqui o link do Pinterest' }
];

function formatBytes(bytes) {
  if (!bytes) return 'Indisponível';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function storedHistory() {
  try {
    return JSON.parse(localStorage.getItem('neontube-history') || '[]');
  } catch {
    return [];
  }
}

function App() {
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState('youtube');
  const [video, setVideo] = useState(null);
  const [quality, setQuality] = useState('best');
  const [mode, setMode] = useState('video-audio');
  const [container, setContainer] = useState('mp4');
  const [playlist, setPlaylist] = useState(false);
  const [subtitles, setSubtitles] = useState(false);
  const [analysisState, setAnalysisState] = useState('idle');
  const [error, setError] = useState('');
  const [job, setJob] = useState(null);
  const [history, setHistory] = useState(storedHistory);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const selectedEstimate = useMemo(() => {
    if (!video) return null;
    if (mode === 'audio') return video.qualities?.[0]?.estimated?.audioMp3 || video.audioBytes;
    if (quality === 'best') {
      const best = [...(video.qualities || [])].reverse().find((item) => item.fallbackAvailable);
      return mode === 'video-only' ? best?.estimated?.videoOnly : best?.estimated?.withAudio;
    }
    const picked = video.qualities?.find((item) => String(item.height) === quality);
    return mode === 'video-only' ? picked?.estimated?.videoOnly : picked?.estimated?.withAudio;
  }, [mode, quality, video]);

  const availableFormatChips = useMemo(() => {
    if (!video?.formats) return [];
    const unique = new Map();
    for (const format of video.formats) {
      const key = `${format.ext}-${format.height}`;
      if (!unique.has(key)) unique.set(key, `${format.ext.toUpperCase()} ${format.height}p`);
    }
    return [...unique.values()].slice(0, 12);
  }, [video]);

  useEffect(() => {
    localStorage.setItem('neontube-history', JSON.stringify(history.slice(0, 8)));
  }, [history]);

  useEffect(() => {
    if (platform === 'pinterest') {
      setPlaylist(false);
      setSubtitles(false);
    }
  }, [platform]);

  useEffect(() => {
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      const update = JSON.parse(event.data);
      setJob((current) => {
        if (!current || current.jobId !== update.jobId) return current;
        if (update.type === 'progress') return { ...current, ...update, status: 'downloading' };
        if (update.type === 'processing') return { ...current, status: 'processing', message: update.message };
        if (update.type === 'complete') return { ...current, status: 'complete', percent: 100, eta: '0:00' };
        if (update.type === 'cancelled') return { ...current, status: 'cancelled' };
        if (update.type === 'error') return { ...current, status: 'error', error: update.error, message: update.error };
        return current;
      });
    };
    return () => ws.close();
  }, []);

  async function analyze(nextUrl = url) {
    setError('');
    setVideo(null);
    setAnalysisState('loading');
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: nextUrl.trim(), platform, playlist })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setVideo(data);
      setAnalysisState('ready');
      const best = [...data.qualities].reverse().find((item) => item.available || item.fallbackAvailable);
      setQuality(best ? String(best.height) : 'best');
    } catch (err) {
      setError(err.message || 'Nao foi possivel analisar este link.');
      setAnalysisState('error');
    }
  }

  async function startDownload() {
    if (!video) return;
    setError('');
    const response = await fetch('/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        platform,
        title: video.title,
        quality,
        mode,
        container,
        playlist,
        subtitles
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Nao foi possivel iniciar o download.');
      return;
    }
    const item = {
      id: data.jobId,
      title: video.title,
      thumb: video.thumbnail,
      mode,
      quality,
      container: mode === 'audio' ? 'mp3' : container,
      platform,
      date: new Date().toLocaleString('pt-BR')
    };
    setHistory((items) => [item, ...items.filter((old) => old.id !== item.id)].slice(0, 8));
    setJob({ jobId: data.jobId, status: 'starting', percent: 0, speed: '', eta: '', title: video.title, downloadDir: data.downloadDir });
  }

  async function cancelDownload() {
    if (!job?.jobId) return;
    await fetch(`/api/downloads/${job.jobId}/cancel`, { method: 'POST' });
    setJob((current) => (current ? { ...current, status: 'cancelled' } : current));
  }

  function handleDrop(event) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const text = event.dataTransfer.getData('text/plain') || event.dataTransfer.getData('text/uri-list');
    if (text) {
      setUrl(text.trim());
      analyze(text.trim());
    }
  }

  const canDownload = video && !['starting', 'downloading', 'processing'].includes(job?.status);
  const progress = Math.min(100, Math.max(0, job?.percent || 0));
  const selectedPlatform = platformOptions.find((item) => item.value === platform) || platformOptions[0];

  return (
    <main
      className={dragging ? 'app is-dragging' : 'app'}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <section className="shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark"><Radio size={24} /></span>
            <div>
              <strong>NeonTube</strong>
              <small>Studio Downloader</small>
            </div>
          </div>

          <div className="status-card">
            <Sparkles size={18} />
            <span>Downloads em alta resolução com conversão automática e progresso ao vivo.</span>
          </div>

          <div className="history">
            <div className="section-title">
              <History size={17} />
              <span>Recentes</span>
            </div>
            {history.length === 0 && <p className="muted">Nenhum download iniciado ainda.</p>}
            {history.map((item) => (
              <article className="history-item" key={item.id}>
                <img src={item.thumb} alt="" />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.quality === 'best' ? 'Melhor' : `${item.quality}p`} · {item.container.toUpperCase()}</span>
                </div>
              </article>
            ))}
          </div>
        </aside>

        <section className="workspace">
          <header className="hero">
            <div>
              <span className="eyebrow"><Activity size={16} /> Rápido, limpo e local</span>
              <h1>Seu hub premium para baixar vídeos, áudio e playlists.</h1>
            </div>
            <div className="live-chip">
              <span />
              yt-dlp engine
            </div>
          </header>

          <section className="url-panel">
            <div className="platform-tabs" aria-label="Escolha a plataforma">
              {platformOptions.map(({ label, value, icon: Icon }) => (
                <button
                  key={value}
                  className={platform === value ? 'platform-tab active' : 'platform-tab'}
                  type="button"
                  onClick={() => {
                    setPlatform(value);
                    setVideo(null);
                    setError('');
                  }}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </div>
            <div className="input-wrap">
              <Link2 size={21} />
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') analyze();
                }}
                placeholder={selectedPlatform.placeholder}
              />
              <button className="primary" onClick={() => analyze()} disabled={!url || analysisState === 'loading'}>
                {analysisState === 'loading' ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                Analisar
              </button>
            </div>
            <div className="toggles">
              <label><input type="checkbox" checked={playlist} disabled={platform !== 'youtube'} onChange={(event) => setPlaylist(event.target.checked)} /> Playlist</label>
              <label><input type="checkbox" checked={subtitles} disabled={platform !== 'youtube'} onChange={(event) => setSubtitles(event.target.checked)} /> Legendas</label>
            </div>
          </section>

          {error && (
            <div className="notice error">
              <ShieldAlert size={18} />
              {error}
            </div>
          )}

          <section className="content-grid">
            <article className="preview">
              {video ? (
                <>
                  <img className="thumb" src={video.thumbnail} alt="" />
                  <div className="video-meta">
                    <div>
                      <h2>{video.title}</h2>
                      <p><Clock3 size={16} /> {video.durationLabel} {video.playlistItems ? `· ${video.playlistItems} itens` : ''}</p>
                    </div>
                    <div className="max-quality">{video.maxHeight >= 2160 ? '4K' : `${video.maxHeight || 0}p`}</div>
                  </div>
                  <div className="format-strip">
                    {availableFormatChips.map((item) => <span key={item}>{item}</span>)}
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <Download size={42} />
                  <h2>Arraste um link ou cole a URL para começar.</h2>
                  <p>O app carrega título, capa, duração, formatos e tamanhos antes do download.
                  mas para isso, vc necessáriamente precisará adicionar um cookie.txt no seu vscode com seus cookies para burlar o sistema do youtube</p>
                </div>
              )}
            </article>

            <article className="control-panel">
              <div className="section-title">
                <Gauge size={18} />
                <span>Preferências</span>
              </div>

              <div className="field">
                <span>Qualidade</span>
                <div className="quality-grid">
                  {qualityOptions.map((option) => {
                    const profile = video?.qualities?.find((item) => String(item.height) === option.value);
                    const disabled = option.value !== 'best' && video && !profile?.fallbackAvailable;
                    return (
                      <button
                        key={option.value}
                        className={quality === option.value ? 'pill active' : 'pill'}
                        disabled={disabled}
                        onClick={() => setQuality(option.value)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="field">
                <span>Conteúdo</span>
                <div className="mode-grid">
                  {modeOptions.map(({ label, value, icon: Icon }) => (
                    <button key={value} className={mode === value ? 'mode active' : 'mode'} onClick={() => setMode(value)}>
                      <Icon size={18} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="split-fields">
                <div className="field">
                  <span>Formato</span>
                  <select value={mode === 'audio' ? 'mp3' : container} onChange={(event) => setContainer(event.target.value)} disabled={mode === 'audio'}>
                    <option value="mp4">MP4</option>
                    <option value="webm">WEBM</option>
                    <option value="mp3">MP3</option>
                  </select>
                </div>
                <div className="estimate">
                  <span>Tamanho estimado</span>
                  <strong>{formatBytes(selectedEstimate)}</strong>
                </div>
              </div>

              <button className="download-button" disabled={!canDownload} onClick={startDownload}>
                <Download size={20} />
                Baixar agora
              </button>
            </article>
          </section>

          {job && (
            <section className={`download-dock ${job.status}`}>
              <div className="dock-top">
                <div>
                  <strong>{job.title}</strong>
                  <span>{job.message || (job.status === 'processing' ? 'Convertendo arquivo' : job.status)}</span>
                </div>
                {['starting', 'downloading', 'processing'].includes(job.status) ? (
                  <button className="ghost" onClick={cancelDownload}><PauseCircle size={18} /> Cancelar</button>
                ) : (
                  <button className="ghost" onClick={() => setJob(null)}><RotateCcw size={18} /> Limpar</button>
                )}
              </div>
              <div className="progress-track">
                <div style={{ width: `${progress}%` }} />
              </div>
              <div className="metrics">
                <span>{Math.round(progress)}%</span>
                <span>{job.speed || 'Preparando'}</span>
                <span>{job.eta ? `Restante ${job.eta}` : job.downloadDir}</span>
                {job.status === 'complete' && <span><Check size={15} /> Concluído</span>}
              </div>
            </section>
          )}
        </section>
      </section>

      <div className="drop-overlay">
        <Music2 size={44} />
        <strong>Solte o link para analisar</strong>
      </div>
    </main>
  );
}

export default App;
