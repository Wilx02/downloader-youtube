# NeonTube Downloader

Aplicativo local para analisar e baixar videos do YouTube com qualidade selecionavel, audio MP3, legendas, playlists, progresso em tempo real e cancelamento.

## Requisitos

- Windows
- Node.js 22+
- Internet para analisar e baixar os videos

## Como rodar

```bash
npm install
npm run dev
```

Abra:

```text
http://127.0.0.1:5173/
```

Os downloads sao salvos em:

```text
C:\Users\<seu-usuario>\Downloads\NeonTube
```

## Observacoes

- O `npm install` baixa automaticamente o `yt-dlp.exe` para `bin/`.
- O app usa `ffmpeg-static` para mesclar video/audio e converter MP3 ou legendas quando necessario.
- Se o YouTube pedir login, exporte seus cookies para um arquivo `cookies.txt` e coloque na raiz do projeto, ao lado do `package.json`. Tambem da para usar `YTDLP_COOKIES_FILE=C:\caminho\cookies.txt`.
- Respeite os termos das plataformas e baixe apenas conteudos que voce tem permissao para salvar.
