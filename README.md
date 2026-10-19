# Transcript Studio

App web local para importar, gravar, transcrever e gerar atas de reuniões. O backend é FastAPI e o frontend é React. Tudo roda no próprio computador, com Ollama para o modelo de linguagem e faster-whisper para a transcrição.

O plano completo está em [`docs/PLANO.md`](docs/PLANO.md). Fases prontas: **0 (estrutura)**, **1 (banco, CRUD, áudio e importação)**, **2 (transcrição na GPU)**, **3 (ata com o Ollama)** e **4 (acabamento da interface)**.

## Interface (fase 4)

- **Busca rápida (Ctrl+K / ⌘K):** acha qualquer reunião pelo título, pelos participantes ou por algo que foi dito, e tem atalhos para nova reunião e troca de tema.
- **Busca na transcrição:** ignora acentos ("comissao" encontra "comissão"), destaca as ocorrências e navega entre elas com Enter / Shift+Enter.
- **Player:** Espaço toca/pausa, ←/→ pulam 5 s, Shift+←/→ pulam 30 s. O trecho que está tocando fica destacado, e "Seguir áudio" rola junto.
- **Fila da GPU na barra lateral:** mostra o que está rodando, a etapa e o que vem a seguir. Avisa quando uma transcrição ou ata termina, mesmo que você esteja em outra página.
- **Celular e tema claro/escuro** revisados, título da aba por página (⏳ enquanto processa) e páginas carregadas sob demanda.

## Ata (fase 3)

Na aba **Ata**, escolha o modelo e clique em **Gerar com IA**. Reuniões longas são lidas em partes (notas curtas por trecho) e depois a ata é escrita, com o texto aparecendo enquanto o modelo escreve. Cada geração ou edição vira uma versão nova: dá para ver as anteriores e restaurar. **Exportar** baixa a ata em `.docx` ou `.md`, a transcrição em `.txt` e legendas `.srt`.

Comparação na reunião ADM (32 min, 20 mil caracteres de transcrição), na mesma RTX 4050:

| Modelo | Tempo | Onde roda | Resultado |
| --- | --- | --- | --- |
| **qwen3.5:4b** (padrão) | 44 s | 100% GPU | Ata organizada, usa o contexto para acertar nomes, poucas tarefas e todas com responsável |
| qwen3:8b | 312 s | 37% CPU | Mais exaustiva, mas lista fatos como "tarefas" |

Detalhes que deixam isso rápido e confiável:
- Antes de o Ollama carregar, o Whisper sai da GPU, porque os dois não cabem juntos em 6 GB.
- Notas limitadas a 700 tokens por trecho. A consolidação roda no máximo 2 rodadas e só repete se as notas encolherem: um modelo prolixo deixava o laço sem fim.
- `repeat_penalty` evita que modelos pequenos repitam a mesma frase.
- O contexto de `data/context/` (glossário, entidades e grupos, importado do transcript-mk) entra no prompt só para acertar nomes, sem ser citado.

## Transcrição (fase 2)

Na página da reunião, escolha o modo e clique em **Transcrever**. O texto aparece enquanto o Whisper trabalha, cada trecho com o horário dele. Clicar no horário pula o áudio para ali, e o trecho que está tocando fica destacado.

Medido no seu notebook (RTX 4050 6 GB, `large-v3-turbo` com `int8_float16`):

| Modo | Como funciona | Reunião de 32 min | Reunião de 70 min |
| --- | --- | --- | --- |
| **Rápido** (padrão) | Lote de 16 janelas por vez; trechos de até ~30 s | 26 s (75x) | 82 s (51x, incluindo preparar o áudio) |
| **Detalhado** | Sequencial, frase a frase (~3 s por trecho) | 59 s (32x) | ~2 min 10 s (estimado) |

Como fica rápido:
- **Fila única de GPU** (`services/gpu_worker.py`): um trabalho por vez, e antes de transcrever o Ollama é mandado descarregar os modelos (`keep_alive: 0`). Com os dois juntos na GPU de 6 GB, a transcrição ficava mais de 100x mais lenta.
- **Whisper pré-carregado** quando o servidor sobe (`STUDIO_WHISPER_PRELOAD=true`): a primeira tarefa cai de ~35 s para ~3 s.
- **Modo em lote** do faster-whisper (`STUDIO_WHISPER_BATCH_SIZE=16`; 24 não ganhou nada).
- **Retomada:** tarefas interrompidas por um reinício voltam para a fila sozinhas.

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

## API

| Método | Rota |
| --- | --- |
| GET / POST | `/api/meetings` (lista com `?q=` e `?status=`; criar) |
| POST | `/api/meetings/from-audio` (cria a reunião e envia o áudio em uma chamada) |
| GET / PATCH / DELETE | `/api/meetings/{id}` |
| PUT / GET / DELETE | `/api/meetings/{id}/audio` (o GET aceita Range, para avançar e voltar no player) |
| GET | `/api/meetings/{id}/audio/peaks` |
| GET / PUT | `/api/meetings/{id}/transcript` |
| GET / PUT | `/api/meetings/{id}/minutes` (cada PUT vira uma nova versão) |
| POST | `/api/meetings/{id}/transcribe` (`{"mode": "fast"\|"detailed", "language": "pt"}`; 409 se já houver uma tarefa) |
| GET | `/api/meetings/{id}/job` (última tarefa da reunião) |
| GET | `/api/jobs`, `/api/jobs/{id}`; POST `/api/jobs/{id}/cancel` |
| GET | `/api/jobs/{id}/events` (SSE: snapshot, status, segments, done/error/cancelled) |
| POST | `/api/meetings/{id}/minutes/generate` (`{"model": "qwen3.5:4b"}`; 409 sem transcrição) |
| GET | `/api/meetings/{id}/minutes/{versão}` (uma versão antiga da ata) |
| GET | `/api/meetings/{id}/export?format=md\|docx\|txt\|srt` |
| GET | `/api/models` (modelos instalados no Ollama e o padrão) |
| GET | `/api/health` (status do Ollama e da fila de GPU) |

A documentação interativa fica em http://localhost:8000/docs.
