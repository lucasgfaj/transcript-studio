# Transcript Studio

App web local para importar, gravar, transcrever e gerar atas de reuniões. O backend é FastAPI e o frontend é React. Tudo roda no próprio computador, com Ollama para o modelo de linguagem e faster-whisper para a transcrição.

O plano completo está em [`docs/PLANO.md`](docs/PLANO.md). Fases prontas: **0 (estrutura)** e **1 (banco, CRUD, áudio e importação)**.

## Como rodar

Pré-requisitos, todos dentro do WSL: [uv](https://docs.astral.sh/uv/), Node (via nvm) e o Ollama aberto no Windows (com a rede espelhada do WSL ativa).

```bash
cd ~/transcript-studio
(cd backend && uv sync)          # primeira vez
(cd frontend && npm install)     # primeira vez
./dev.sh                         # API em :8000 + interface em http://localhost:5173
```

Para rodar tudo em um processo só, com o frontend já compilado:

```bash
./dev.sh build
cd backend && uv run transcript-studio   # http://localhost:8000
```

Para importar as reuniões do projeto antigo (só copia; os originais ficam onde estão, e rodar de novo não duplica):

```bash
cd backend && uv run python -m transcript_studio.services.importer ~/transcript-mk
```

Testes:

```bash
cd backend && uv run pytest
cd frontend && npm run build     # inclui a checagem de tipos (tsc)
```

## Arquitetura (MVC + SOLID)

```text
frontend/ (View)              React 19 + Vite + Tailwind v4 + shadcn/ui
  src/components/ui/          componentes shadcn e agent-chat.tsx (alias @/components/ui)
  src/components/meetings/    player com waveform, gravador, painéis de transcrição, ata e chat
  src/pages/                  Biblioteca, Nova reunião, Reunião
  src/lib/api.ts              cliente tipado da API
  src/hooks/                  TanStack Query (cache, invalidação)

backend/src/transcript_studio/
  controllers/   Controller: rotas FastAPI; só HTTP, sem regra de negócio
  schemas/       contratos de entrada e saída da API
  services/      regras de negócio (status, versões da ata, importação)
  domain/        ports.py (interfaces/Protocols) e erros de domínio
  models/        Model: tabelas SQLModel
  repositories/  implementação SQL das interfaces
  infrastructure/ arquivos de áudio, waveform (PyAV + numpy), cliente Ollama
  core/          configuração, banco, dependencies.py (composition root)
```

| Princípio | Onde aparece |
| --- | --- |
| **S** (responsabilidade única) | Repositório só faz SQL; `FileAudioStorage` só cuida de arquivos; `CachedWaveform` só gera picos; o controller só traduz HTTP |
| **O** (aberto/fechado) | Um provedor novo (Whisper, Ollama, Groq) entra como outra implementação de um port, sem mexer nos services |
| **L** (substituição) | Qualquer implementação que cumpra o Protocol funciona, inclusive fakes nos testes |
| **I** (interfaces enxutas) | `MeetingRepository`, `SegmentRepository`, `MinutesRepository`, `AudioStorage`, `WaveformProvider` são separados |
| **D** (inversão de dependência) | Services recebem Protocols; só `core/dependencies.py` escolhe as classes concretas |

## Dados

- `data/studio.db`: SQLite com reuniões, segmentos e versões da ata.
- `data/meetings/<id>/audio.<ext>`: o áudio original, mais o cache da forma de onda.
- `data/` fica fora do Git porque contém o conteúdo das reuniões.

## API (fase 1)

| Método | Rota |
| --- | --- |
| GET / POST | `/api/meetings` (lista com `?q=` e `?status=`; criar) |
| POST | `/api/meetings/from-audio` (cria a reunião e envia o áudio em uma chamada) |
| GET / PATCH / DELETE | `/api/meetings/{id}` |
| PUT / GET / DELETE | `/api/meetings/{id}/audio` (o GET aceita Range, para avançar e voltar no player) |
| GET | `/api/meetings/{id}/audio/peaks` |
| GET / PUT | `/api/meetings/{id}/transcript` |
| GET / PUT | `/api/meetings/{id}/minutes` (cada PUT vira uma nova versão) |
| GET | `/api/health` (status do Ollama) |

A documentação interativa fica em http://localhost:8000/docs.
