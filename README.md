# Transcript Studio

App web **100% local** para importar ou gravar reuniões, transcrever o áudio com horários clicáveis, gerar a **ata com IA** e conversar com a reunião em um chat. Nada sai do computador: a transcrição usa o [faster-whisper](https://github.com/SYSTRAN/faster-whisper) na GPU e a ata e o chat usam um modelo local do [Ollama](https://ollama.com).

| | |
| --- | --- |
| **Backend** | Python 3.12, FastAPI, SQLModel (SQLite), faster-whisper |
| **Frontend** | React 19, Vite, Tailwind v4, shadcn/ui, TanStack Query, wavesurfer.js |
| **IA local** | Ollama (padrão `qwen3.5:4b`) e Whisper `large-v3-turbo` |
| **Ambiente** | Windows + WSL (Ubuntu), GPU NVIDIA (testado em RTX 4050 6 GB) |

---

## Sumário

1. [O que o app faz](#o-que-o-app-faz)
2. [Pré-requisitos](#pré-requisitos)
3. [Instalação (primeira vez)](#instalação-primeira-vez)
4. [Como usar no dia a dia](#como-usar-no-dia-a-dia)
5. [Passo a passo de uma reunião](#passo-a-passo-de-uma-reunião)
6. [Configuração](#configuração)
7. [Dados e privacidade](#dados-e-privacidade)
8. [Arquitetura](#arquitetura)
9. [API](#api)
10. [Desenvolvimento e testes](#desenvolvimento-e-testes)
11. [Problemas comuns](#problemas-comuns)

---

## O que o app faz

| Tela | Para quê |
| --- | --- |
| **Biblioteca** | Lista todas as reuniões, com busca por título, participantes ou por algo que foi dito. |
| **Nova reunião** | Envia um arquivo de áudio (wav, mp3, m4a…) ou grava pelo microfone. |
| **Ao vivo** | Grava pelo microfone e mostra o texto a cada pausa na fala, em tempo real. |
| **Reunião** | Player com forma de onda, transcrição clicável, aba **Ata** e aba **Chat**. |
| **Modelos** | Escolhe, baixa e apaga modelos do Ollama e troca o tamanho do Whisper. |
| **Contexto** | Edita arquivos Markdown (glossário, pessoas, empresas) que ajudam a IA a acertar nomes. |

Recursos principais:

- **Transcrição na GPU** com horário em cada trecho. Clicar no horário pula o áudio para ali.
  Modo **Rápido** (lote, ~75x o tempo real) ou **Detalhado** (frase a frase).
- **Ata gerada por IA** em streaming. Reuniões longas são lidas em partes e depois consolidadas.
  Cada geração ou edição vira uma **versão**, que pode ser restaurada.
- **Exportação** da ata em `.docx` ou `.md`, da transcrição em `.txt` e de legendas `.srt`.
- **Chat com a reunião**: perguntas como "liste as tarefas" ou "o que foi dito sobre o orçamento?".
  Cada horário citado na resposta, como **[33:35]**, é um botão que toca o áudio daquele ponto.
- **Fila única de GPU**: um trabalho por vez (transcrição, ata ou chat), com o progresso na barra lateral.
- **Busca rápida** com `Ctrl+K`, tema claro/escuro e layout que funciona no celular.

---

## Pré-requisitos

No **Windows**:

1. **WSL com Ubuntu** (`wsl --install -d Ubuntu`).
2. **Driver NVIDIA** atualizado (a GPU fica disponível dentro do WSL automaticamente).
3. **[Ollama para Windows](https://ollama.com/download)** instalado e aberto.
4. **Rede espelhada no WSL**, para o WSL enxergar o Ollama em `localhost`. Crie ou edite
   `C:\Users\<você>\.wslconfig`:

   ```ini
   [wsl2]
   networkingMode=mirrored
   ```

   Depois rode `wsl --shutdown` no PowerShell e abra o WSL de novo.

No **WSL (Ubuntu)**:

```bash
# uv (gerenciador de Python)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install --lts

# ffmpeg não é necessário: o áudio é lido com PyAV
```

---

## Instalação (primeira vez)

```bash
cd ~
git clone https://github.com/lucasgfaj/transcript-studio.git
cd transcript-studio
chmod +x dev.sh
./dev.sh start
```

Na primeira execução o `dev.sh` instala sozinho as dependências do backend (`uv sync`) e do frontend (`npm install`), compila a interface e abre o navegador em **http://localhost:8000**.

Baixe pelo menos um modelo de linguagem no Ollama (ou pela tela **Modelos** do app):

```bash
ollama pull qwen3.5:4b
```

O modelo do Whisper é baixado automaticamente no primeiro uso.

> **Atalho no Windows:** o arquivo `Transcript Studio.bat` sobe o app dentro do WSL e abre o navegador.
> Copie-o para a Área de Trabalho e dê dois cliques. Ele assume que o projeto está em `~/transcript-studio`
> na distribuição `Ubuntu`; ajuste a linha do `wsl.exe` se for diferente.

---

## Como usar no dia a dia

1. Abra o **Ollama** no Windows (necessário para a ata e o chat; a transcrição funciona sem ele).
2. Dê dois cliques em **`Transcript Studio.bat`** ou rode no WSL:

   ```bash
   cd ~/transcript-studio
   ./dev.sh start
   ```

3. Use o app em **http://localhost:8000**.
4. Para parar: feche a janela do `.bat` ou aperte `Ctrl+C` no terminal.

Comandos do `dev.sh`:

| Comando | Para quê |
| --- | --- |
| `./dev.sh start` | Uso normal: compila a interface e serve tudo em http://localhost:8000 |
| `./dev.sh` | Desenvolvimento: API com recarga em :8000 e interface com hot reload em http://localhost:5173 |
| `./dev.sh test` | Testes do backend, checagem de tipos e build da interface |
| `./dev.sh build` | Só compila a interface (`frontend/dist`) |

---

## Passo a passo de uma reunião

1. **Criar a reunião**
   - Em **Nova reunião**, arraste o arquivo de áudio ou grave pelo microfone; ou
   - Em **Ao vivo**, clique em gravar. Use **Encontrar meu microfone** se o medidor não se mexer.
     O áudio é salvo no servidor enquanto você fala, então fechar a aba não perde nada.
2. **Transcrever**: na página da reunião, escolha o modo (**Rápido** ou **Detalhado**) e clique em
   **Transcrever**. O texto aparece enquanto o Whisper trabalha.
3. **Revisar**: clique nos horários para ouvir o trecho. Atalhos do player: `Espaço` toca/pausa,
   `←`/`→` pulam 5 s, `Shift+←`/`→` pulam 30 s. A busca na transcrição ignora acentos.
4. **Gerar a ata**: na aba **Ata**, escolha o modelo e clique em **Gerar com IA**. Edite à vontade;
   cada edição vira uma versão nova.
5. **Perguntar**: na aba **Chat**, faça perguntas sobre a reunião. O botão **Parar** interrompe a resposta.
6. **Exportar**: botão **Exportar** → `.docx`, `.md`, `.txt` ou `.srt`.

### Contexto (opcional, mas recomendado)

Na tela **Contexto**, crie arquivos Markdown com glossário, nomes de pessoas, cargos e empresas. Esse texto entra no prompt da ata e do chat **só para acertar a grafia dos nomes**, sem ser citado. A tela mostra quantos caracteres vão para o prompt e quais arquivos ficaram de fora por falta de espaço. Arquivos `README.md` dentro do contexto não entram no prompt.

### Importar reuniões de um projeto antigo

Se você tem as pastas do projeto anterior (`transcript-mk`), dá para copiar reuniões e contexto para o app. Os originais não são alterados e rodar de novo não duplica:

```bash
cd ~/transcript-studio/backend
uv run python -m transcript_studio.services.importer ~/transcript-mk
```

---

## Configuração

Tudo funciona sem configuração. Para mudar os padrões, copie o exemplo e edite:

```bash
cp backend/.env.example backend/.env
```

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `STUDIO_OLLAMA_URL` | `http://localhost:11434` | Endereço do Ollama |
| `STUDIO_DEFAULT_LLM` | `qwen3.5:4b` | Modelo padrão da ata e do chat |
| `STUDIO_DEFAULT_WHISPER` | `large-v3-turbo` | Modelo do Whisper |
| `STUDIO_GPU_MEMORY_GB` | `6` | Memória da GPU, usada para dizer quais modelos cabem inteiros nela |
| `STUDIO_WHISPER_PRELOAD` | `true` | Carrega o Whisper quando o servidor sobe |
| `STUDIO_WHISPER_BATCH_SIZE` | `16` | Tamanho do lote no modo Rápido |
| `STUDIO_DATA_DIR` | `./data` | Onde ficam banco, áudios e contexto |

As escolhas feitas nas telas **Modelos** e **Contexto** ficam salvas no banco (tabela `appsetting`) e têm prioridade sobre o `.env`.

---

## Dados e privacidade

Todo o conteúdo das reuniões fica na pasta `data/`, **que não vai para o Git**:

```text
data/
  studio.db                    SQLite: reuniões, segmentos, versões da ata, chat, tarefas
  meetings/<id>/audio.<ext>    áudio original + cache da forma de onda
  context/                     arquivos de contexto (nomes de pessoas e empresas)
```

O `.gitignore` também bloqueia `.env`, bancos (`*.db`, `*.sqlite`), áudios soltos (`*.wav`, `*.mp3`, `*.m4a`…), exportações (`*.docx`, `*.srt`), ambientes virtuais, `node_modules` e o build do frontend. **Faça backup da pasta `data/`** se quiser guardar as reuniões: ela não está no repositório.

Antes de um commit, confira o que vai subir:

```bash
git status
git ls-files | grep -E '^data/|\.env$|\.db$|\.wav$'   # não deve mostrar nada
```

---

## Arquitetura

```text
Navegador (React)  ──HTTP / SSE / WebSocket──▶  FastAPI  ──▶  Fila de GPU (1 trabalho por vez)
                                                  │             ├─ faster-whisper (fica carregado)
                                                  │             └─ Ollama  http://localhost:11434
                                                  ├─ SQLite  data/studio.db
                                                  └─ data/meetings/<id>/  (áudio)
```

Whisper e Ollama não cabem juntos numa GPU de 6 GB, e disputá-la deixa tudo mais de 100x mais lento. Por isso a **fila de GPU** (`services/gpu_worker.py`) roda um trabalho por vez e descarrega o modelo que não está em uso. Durante uma gravação ao vivo a fila pausa.

```text
frontend/                         View: React 19 + Vite + Tailwind v4 + shadcn/ui
  src/pages/                      Biblioteca, Nova reunião, Ao vivo, Reunião, Modelos, Contexto
  src/components/meetings/        player, gravador, painéis de transcrição, ata e chat
  src/components/ui/              componentes shadcn
  src/hooks/                      TanStack Query, microfone, gravação ao vivo
  src/lib/api.ts                  cliente tipado da API

backend/src/transcript_studio/
  main.py          cria o app, monta /api e serve o frontend compilado
  controllers/     rotas FastAPI (só HTTP, sem regra de negócio)
  schemas/         contratos de entrada e saída da API
  services/        regras de negócio: transcrição, ata, chat, ao vivo, busca, importação
  domain/          ports.py (interfaces/Protocols) e erros de domínio
  models/          tabelas SQLModel
  repositories/    implementação SQL das interfaces
  infrastructure/  Whisper, Ollama, arquivos de áudio, waveform, .docx, contexto
  core/            configuração, banco e dependencies.py (composition root)
```

O backend segue **MVC + SOLID**: os services recebem interfaces (`Protocol`) e só `core/dependencies.py` escolhe as classes concretas. Trocar o provedor (por exemplo, outro modelo de transcrição) é criar outra implementação do port, sem mexer nas regras de negócio. O plano completo do projeto está em [`docs/PLANO.md`](docs/PLANO.md); os requisitos em [`docs/PRD.md`](docs/PRD.md), o desenho do software em [`docs/SDD.md`](docs/SDD.md) e o plano de identificar quem fala em [`docs/PLANO-VOZ.md`](docs/PLANO-VOZ.md).

### Desempenho medido (RTX 4050 6 GB)

| Tarefa | Resultado |
| --- | --- |
| Transcrição, modo Rápido, reunião de 32 min | 26 s |
| Transcrição, modo Rápido, reunião de 70 min | 82 s |
| Ata com `qwen3.5:4b`, reunião de 32 min | 44 s (100% na GPU) |
| Ata com `qwen3:8b`, mesma reunião | 312 s (parte na CPU) |
| Chat, primeiro token | ~1 s |
| Ao vivo, texto depois da pausa | mediana 1,4 s |

---

## API

A documentação interativa fica em **http://localhost:8000/docs**.

| Método | Rota |
| --- | --- |
| GET / POST | `/api/meetings` (lista com `?q=` e `?status=`; criar) |
| POST | `/api/meetings/from-audio` (cria a reunião e envia o áudio em uma chamada) |
| GET / PATCH / DELETE | `/api/meetings/{id}` |
| PUT / GET / DELETE | `/api/meetings/{id}/audio` (GET aceita Range) |
| GET | `/api/meetings/{id}/audio/peaks` |
| GET / PUT | `/api/meetings/{id}/transcript` |
| POST | `/api/meetings/{id}/transcribe` (`{"mode": "fast"\|"detailed", "language": "pt"}`) |
| GET / PUT | `/api/meetings/{id}/minutes` (cada PUT vira uma nova versão) |
| POST | `/api/meetings/{id}/minutes/generate` (`{"model": "qwen3.5:4b"}`) |
| GET | `/api/meetings/{id}/minutes/{versão}` |
| GET | `/api/meetings/{id}/export?format=md\|docx\|txt\|srt` |
| GET / POST / DELETE | `/api/meetings/{id}/chat` (resposta em NDJSON) |
| GET | `/api/meetings/{id}/job`, `/api/jobs`, `/api/jobs/{id}`; POST `/api/jobs/{id}/cancel` |
| GET | `/api/jobs/{id}/events` (SSE com o progresso) |
| WS | `/api/live` (gravação ao vivo; protocolo em `controllers/live.py`) |
| GET / POST / DELETE | `/api/models`, `/api/models/pull`, `/api/models/{nome}` |
| GET / PUT | `/api/preferences` |
| GET / PUT / DELETE | `/api/context`, `/api/context/file?path=` |
| GET | `/api/health` (status do Ollama e da fila de GPU) |

---

## Desenvolvimento e testes

```bash
./dev.sh          # API em :8000 com recarga + interface em http://localhost:5173 com hot reload
./dev.sh test     # pytest do backend + checagem de tipos e build do frontend
```

Só o backend:

```bash
cd backend
uv sync
uv run pytest -q
uv run uvicorn transcript_studio.main:app --reload --port 8000
```

Só o frontend:

```bash
cd frontend
npm install
npm run dev       # http://localhost:5173 (as chamadas /api vão para :8000)
npm run lint
npm test          # testes (Vitest); npm run test:watch roda a cada alteração
```

Os testes usam implementações falsas (fakes) do Whisper e do Ollama, então rodam sem GPU e sem o Ollama aberto. O projeto segue TDD: toda mudança começa por um teste. A estratégia completa, com a cobertura mínima de cada parte, está em [`docs/SDD.md`](docs/SDD.md#13-estratégia-de-testes-tdd).

---

## Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| "Ollama offline" na barra lateral | Abrir o Ollama no Windows e conferir `networkingMode=mirrored` no `.wslconfig` (depois `wsl --shutdown`). |
| Ao vivo grava, mas não aparece texto | Usar **Encontrar meu microfone**. No Windows: Configurações → Privacidade → Microfone → permitir aplicativos da área de trabalho. |
| Ata ou chat muito lentos | Em **Modelos**, escolher um modelo marcado "Cabe inteiro na GPU" (ex.: `qwen3.5:4b`). Na tomada, a GPU do notebook fica mais rápida. |
| Primeira transcrição demora | O Whisper carrega quando o servidor sobe (~10 s); modelos novos do Whisper baixam no primeiro uso. |
| Script no Windows demora ~21 s para conectar | Usar `127.0.0.1` em vez de `localhost` (o Windows tenta IPv6 primeiro). |
| `Transcript Studio.bat` não encontra o projeto | Conferir o nome da distribuição (`wsl -l -v`) e o caminho `~/transcript-studio` dentro do `.bat`. |
| Pouca memória no WSL | O WSL enxerga metade da RAM. Aumentar em `.wslconfig` com `memory=12GB`. |
