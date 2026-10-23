# Transcript Studio: SDD (desenho do software)

| | |
| --- | --- |
| **Versão do documento** | 1.0 |
| **Data** | 2026-10-23 |
| **Relacionados** | [PRD](PRD.md) · [Plano original](PLANO.md) · [Plano: reconhecimento de voz](PLANO-VOZ.md) |

Este documento descreve **como** o sistema é construído. O **quê** e o **porquê** estão no [PRD](PRD.md).

---

## 1. Visão geral

```text
Navegador (React)  ──HTTP / SSE / NDJSON / WebSocket──▶  FastAPI (uvicorn, :8000)
                                                           │
                    ┌──────────────────────────────────────┼─────────────────────────────┐
                    │                                      │                             │
              Controllers ──▶ Services ──▶ Ports ◀── Repositories (SQLite)        GpuWorker (thread única)
                                              ▲                                     ├─ TranscriptionJobHandler ─▶ faster-whisper
                                              └──── Infrastructure ─────────────────┤
                                                    (Whisper, Ollama, áudio,        └─ MinutesJobHandler ─▶ Ollama :11434
                                                     waveform, docx, contexto)
                                                           │
                                         data/studio.db · data/meetings/<id>/ · data/context/
```

Um único processo serve a API (`/api`) e o frontend compilado (`frontend/dist`). Todo trabalho pesado de GPU passa por uma fila de **uma thread**, porque Whisper e LLM juntos numa GPU de 6 GB ficam mais de 100x mais lentos.

## 2. Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Backend | Python 3.12, uv, FastAPI, SQLModel/SQLAlchemy, pydantic-settings |
| Banco | SQLite em WAL, `PRAGMA foreign_keys=ON` (exclusão em cascata) |
| Transcrição | faster-whisper (CTranslate2), `large-v3-turbo`, `int8_float16` na GPU, VAD Silero; PyAV para decodificar |
| LLM | Ollama (`/api/chat`, streaming, `think: false`, `temperature: 0`, `num_ctx` 8192) |
| Documentos | python-docx (exportação `.docx`) |
| Frontend | React 19, Vite, TypeScript, Tailwind v4, shadcn/ui (Radix), TanStack Query, react-router, wavesurfer.js, react-markdown + remark-gfm, sonner, cmdk |
| Testes | pytest + `fastapi.testclient` com fakes de Whisper, Ollama e GPU; `tsc -b`, oxlint e build no frontend |

## 3. Arquitetura do backend

MVC + SOLID com inversão de dependência. Cada camada só conhece a de baixo, e os services dependem de `Protocol`s, nunca de classes concretas.

```text
backend/src/transcript_studio/
  main.py            create_app(): monta routers, trata erros de domínio, serve o SPA
  controllers/       HTTP/WS apenas: validação de entrada e tradução de erros
  schemas/           contratos de entrada e saída (pydantic)
  services/          regras de negócio
  domain/ports.py    interfaces (Transcriber, ChatModel, repositórios, UnitOfWork…)
  domain/errors.py   NotFoundError → 404, ConflictError → 409, InvalidAudioError → 422
  models/            tabelas SQLModel
  repositories/      implementação SQL dos ports (sql.py) e SqlUnitOfWork
  infrastructure/    Whisper, Ollama, disco, waveform, docx, contexto, gravador WAV
  core/              config, db, container (objetos de vida longa), dependencies (composition root)
```

### 3.1 Composição

- **`core/dependencies.py`** é o único lugar que escolhe implementações concretas por requisição (sessão do banco + repositórios SQL + services), via `Depends` do FastAPI.
- **`core/container.py`** cria uma vez por app os objetos de vida longa: `GpuWorker`, `JobEvents`, o `Transcriber` (Whisper carregado), o `ChatModel` (Ollama) e os handlers de job. `create_app(settings, transcriber, gpu, chat)` aceita fakes, e é assim que os testes rodam sem GPU.

### 3.2 Ports principais

| Port | Implementação | Responsabilidade |
| --- | --- | --- |
| `Transcriber` | `FasterWhisperTranscriber` | Arquivo (`transcribe`, modos fast/detailed, callback por trecho, cancelamento) e ao vivo (`transcribe_samples`); `warm_up`/`unload` |
| `ChatModel` | `OllamaChat` | `stream` (system + prompt) e `stream_chat` (multi-turno), com cancelamento e limite de tokens |
| `GpuReleaser` | `OllamaClient` | Libera a VRAM do Ollama (`keep_alive: 0`) antes da transcrição |
| `ContextSource` | `MarkdownContextSource` | Junta os `.md` de `data/context/` dentro de um orçamento de caracteres |
| `DocumentRenderer` | `DocxRenderer` | Markdown → `.docx` |
| `AudioStorage` / `WaveformProvider` | `FileAudioStorage` / `CachedWaveform` | Áudio em `data/meetings/<id>/` e picos da forma de onda em cache |
| `AudioRecorder` | `WavRecorder` | Escreve o ao vivo em disco enquanto grava |
| Repositórios + `UnitOfWork` | `Sql*Repository`, `SqlUnitOfWork` | Persistência; o UoW serve à thread da GPU, fora de uma requisição |

## 4. Modelo de dados

```text
meeting 1──* segment
        1──* minutes      (versões; a mais nova é a atual)
        1──* chatmessage
        1──* job
appsetting (chave/valor)
```

| Tabela | Campos principais |
| --- | --- |
| `meeting` | `id` (uuid hex), `title`, `participants` (JSON), `date`, `language`, `source` (upload/recording/live/import/manual), `source_ref`, `status`, `audio_filename`, `audio_mime`, `audio_size`, `audio_duration`, `transcript`, `created_at`, `updated_at` |
| `segment` | `id`, `meeting_id`, `idx`, `start`, `end`, `text` |
| `minutes` | `id`, `meeting_id`, `markdown`, `model`, `created_at` |
| `chatmessage` | `id`, `meeting_id`, `role` (user/assistant), `content`, `model`, `interrupted`, `created_at` |
| `job` | `id`, `meeting_id`, `kind` (transcribe/minutes), `status`, `params` (JSON), `progress`, `message`, `error`, `audio_seconds`, `elapsed_seconds`, `device`, `created_at`, `started_at`, `finished_at` |
| `appsetting` | `key`, `value` (preferências da interface; vencem o `.env`) |

**Status da reunião:** `draft → audio_ready → transcribing → transcribed → generating → done`, com `error` em falhas. Ao cancelar ou falhar, `rest_status` devolve a reunião ao estado coerente com o que ela tem (áudio, transcrição, ata).

**Esquema:** criado por `SQLModel.metadata.create_all` ao subir. Não há ferramenta de migração; colunas novas em tabelas existentes exigem um passo de migração leve (ver [PLANO-VOZ.md](PLANO-VOZ.md)).

## 5. Fila de GPU e jobs

`services/gpu_worker.py`:

- Uma thread `gpu-worker` consome uma `queue.Queue` de ids de job (ou tarefas sem job, como o aquecimento do Whisper).
- `hold()`/`release()`: o **ao vivo** segura a fila; o job que está rodando termina, e os próximos esperam.
- `exclusive()`: o **chat** espera o job atual terminar, segura a fila e, pelo `ContainerGpuGate`, descarrega o Whisper antes de usar o Ollama.
- Cancelamento cooperativo: `cancel(id)` marca o job e os handlers consultam `JobContext.cancelled()`.
- Uma exceção dentro de um handler é registrada e não derruba a thread.
- `recover_interrupted_jobs`: ao subir, jobs que estavam `queued`/`running` são retomados.

Fluxo de um job:

```text
POST /meetings/{id}/transcribe ─▶ JobService._enqueue (cria Job queued, status da reunião) ─▶ worker.submit
GpuWorker ─▶ handler.run(job_id, ctx) ─▶ JobReporter.status/publish ─▶ JobEvents (pub/sub em memória)
GET /jobs/{id}/events (SSE) ◀── assina JobEvents e recebe primeiro um snapshot (trechos/texto já produzidos)
```

| Handler | Passos |
| --- | --- |
| `TranscriptionJobHandler` | Libera o Ollama → Whisper (lote ou sequencial) → publica trechos em lotes → grava `segment` + `meeting.transcript` → `done` com velocidade (x tempo real) |
| `MinutesJobHandler` | Descarrega o Whisper → `MinutesWriter` em streaming (tokens agrupados a cada 120 ms) → nova versão em `minutes` → `done` |

## 6. Ata (`services/minutes_writer.py`)

Map-reduce para caber em 8k tokens:

1. `split_text` corta a transcrição em pedaços de ~6.000 caracteres (parágrafo → linha → palavra).
2. **Um pedaço:** uma chamada `final` gera a ata direto, em streaming.
3. **Vários pedaços:** cada um gera **notas rotuladas** (`OBJETIVO`, `FATO`, `DECISÃO`, `TAREFA`, `PENDÊNCIA`), com até 700 tokens. Se as notas passarem de 12.000 caracteres, até 2 rodadas de `condense` mantendo os rótulos. Por fim, `final_from_notes` gera a ata (2.500 tokens), e só essa etapa vai em streaming.
4. O prompt final impõe um modelo fixo de Markdown: título, data/participantes, **Objetivo**, Resumo, Tópicos, Decisões, Tarefas (`- [ ] … — Responsável — Prazo`), Pendências e riscos, Próximos passos. Responsável ou prazo não ditos aparecem como "não definido".
5. O contexto de referência entra só para grafar nomes; cercas ```` ``` ```` que o modelo coloque são removidas.

## 7. Chat (`services/chat.py`, `services/retrieval.py`)

1. Valida: precisa ter transcrição ou ata; não pode haver gravação ao vivo; a pergunta não pode ser vazia.
2. **Recuperação:** os trechos viram passagens de ~1.000 caracteres; a pontuação é tipo TF-IDF sobre termos sem acento e sem palavras vazias do português. As melhores entram dentro de um orçamento de 9.000 caracteres (12.500 sem ata), devolvidas em ordem cronológica. Sem termos úteis ("resuma"), as passagens são espalhadas pela reunião.
3. Monta o prompt: dados da reunião, ata (até 3.500 caracteres), trechos com o horário de **cada frase**, referência de nomes (1.500), as últimas 4 mensagens (800 cada) e a pergunta.
4. Responde em **NDJSON** (`status`, `token`, `error`, `done`) dentro de `gpu.exclusive()`.
5. `snap_citations` move cada `[mm:ss]` citado para o início do trecho que o contém, ou o mais próximo, para o clique tocar a frase certa.
6. Se o navegador abortar (botão Parar), o `finally` fecha o stream do Ollama e salva a resposta parcial com `interrupted=True`.

## 8. Ao vivo (`controllers/live.py`, `services/live*.py`)

Protocolo WebSocket `/api/live`:

```text
client → {"type":"start", "title", "participants", "language"}
server → {"type":"ready", "meeting_id", "gpu_busy"}
client → binário PCM 16-bit LE, 16 kHz, mono
server → {"type":"segment", "start", "end", "text"}
server → {"type":"silence", "silent": bool}
client → {"type":"stop"}
server → {"type":"saved", "meeting_id", "segments"} | {"type":"discarded"}
```

- `LiveSegmenter` corta o fluxo em falas: no mínimo 2 s, no máximo 15 s, e corta numa pausa de 0,6 s (energia RMS em quadros de 30 ms). Sem pausa, corta nos 100 ms mais silenciosos dos últimos 3 s. Trechos só de silêncio não vão ao Whisper, o que evita alucinações.
- Cada fala é transcrita com o texto anterior como `initial_prompt`, para dar continuidade.
- `WavRecorder` grava `.live.wav` durante a sessão. Fechar o socket sem `stop` também salva.
- Durante a sessão, `worker.hold()` impede novos jobs de GPU.

## 9. API

Documentação interativa em `/docs`. Resumo:

| Recurso | Rotas |
| --- | --- |
| Reuniões | `GET/POST /api/meetings`, `POST /api/meetings/from-audio`, `GET/PATCH/DELETE /api/meetings/{id}` |
| Áudio | `PUT/GET/DELETE /api/meetings/{id}/audio` (GET com Range), `GET …/audio/peaks` |
| Transcrição | `GET/PUT …/transcript`, `POST …/transcribe` (202) |
| Ata | `GET/PUT …/minutes`, `GET …/minutes/{versão}`, `POST …/minutes/generate` (202) |
| Exportação | `GET …/export?format=md\|docx\|txt\|srt` |
| Chat | `GET/POST/DELETE /api/meetings/{id}/chat` (POST responde NDJSON) |
| Jobs | `GET …/job`, `GET /api/jobs`, `GET /api/jobs/{id}`, `POST /api/jobs/{id}/cancel`, `GET /api/jobs/{id}/events` (SSE) |
| Ao vivo | `WS /api/live` |
| Modelos | `GET/POST/DELETE /api/models`, `/api/models/pull`, `/api/models/{nome}` |
| Preferências e contexto | `GET/PUT /api/preferences`, `GET/PUT/DELETE /api/context`, `/api/context/file?path=` |
| Sistema | `GET /api/health` |

Erros de domínio viram `404`, `409` e `422` em `main.py`. Controllers não contêm regra de negócio.

## 10. Frontend

```text
frontend/src/
  pages/          library, new-meeting, live, meeting, models, context
  components/
    app-shell, command-palette (Ctrl+K), gpu-queue, theme-*
    meetings/     audio-player (wavesurfer), transcript-panel, minutes-panel, chat-panel,
                  recorder, audio-dropzone, transcribe-bar, meeting-details-dialog, status-badge
    ui/           shadcn + agent-chat
  hooks/          use-meetings, use-job (SSE), use-transcription, use-live-recorder (WS + AudioWorklet), use-microphone
  lib/api.ts      cliente tipado da API
```

- **Estado do servidor:** TanStack Query. **Progresso de jobs:** `EventSource` (SSE). **Chat:** `fetch` com leitura de NDJSON e `AbortController`. **Ao vivo:** WebSocket com PCM 16 kHz.
- Em desenvolvimento, o Vite (`:5173`) faz proxy de `/api` para `:8000`. Em produção, o FastAPI serve `frontend/dist`, com fallback para `index.html`.

## 11. Configuração

`Settings` (pydantic-settings, prefixo `STUDIO_`, arquivo `backend/.env`): `data_dir`, `ollama_url`, `default_llm` (`qwen3.5:4b`), `default_whisper` (`large-v3-turbo`), `gpu_memory_gb` (6), `whisper_preload`, `whisper_batch_size` (16), `default_language` (`pt`), `llm_context_tokens` (8192), `minutes_chunk_chars` (6000), `context_max_chars` (4000). O que se muda nas telas Modelos e Contexto fica em `appsetting` e vence o `.env`.

## 12. Segurança e privacidade

- Sem autenticação: o app escuta em `localhost` e é de uso pessoal.
- Nenhuma chamada externa com conteúdo de reunião; o Ollama é local. A internet só é usada para baixar modelos.
- `data/`, `.env`, `*.db`, áudios e exportações estão no `.gitignore`.
- Os caminhos de `/api/context/file` ficam restritos a `data/context/`.

## 13. Estratégia de testes (TDD)

- **Ciclo:** teste que falha → implementação mínima → refatoração. Toda funcionalidade nova começa por um teste: em `backend/tests/` no backend e em um `*.test.ts(x)` ao lado do código no frontend. Correções de bug começam por um teste que reproduz o bug.
- **Dados nos testes:** só nomes e empresas fictícios (Ana, Bruno…). Nada real de reuniões ou de `data/`.
- **Fakes** em `tests/conftest.py`: `FakeTranscriber` (trechos fixos, com `gate` para observar um job rodando e cancelar), `FakeChat` (resposta palavra a palavra, grava os prompts) e `FakeGpu`. O app é criado com `create_app(settings, transcriber=…, chat=…, gpu=…)` e um `data_dir` temporário.
- **Níveis:**
  - unidade: `LiveSegmenter`, `retrieval`, `split_text`, `snap_citations`;
  - serviço: `MinutesWriter` com `FakeChat`;
  - API ponta a ponta com `TestClient`: jobs, SSE, WebSocket ao vivo, cancelamento e retomada após reinício;
  - adaptadores: `OllamaChat`/`OllamaClient` contra um servidor HTTP falso local (`test_ollama.py`); `FasterWhisperTranscriber` com módulos `faster_whisper`/`ctranslate2` falsos (`test_whisper.py`); áudio em disco com arquivos WAV gerados (`test_audio_storage.py`).
- **Frontend:** Vitest + Testing Library + jsdom. A lógica pura fica em `src/lib/` (`format`, `ndjson`, `citations`, `search`, `api`) e é testada diretamente; componentes são testados como o usuário os usa (`transcript-panel`, `status-badge`), com `fetch` simulado por `src/test/render.tsx`.
- **Cobertura mínima** (o teste falha se cair):

  | Parte | Mínimo | Hoje |
  | --- | --- | --- |
  | Backend (linhas + ramificações) | 90% | 93% (82 testes) |
  | Frontend (`lib/`, `components/meetings/`, `hooks/`) | 15% | ~18% (24 testes) |

  O mínimo do frontend sobe à medida que componentes e hooks ganham testes.
- **Comandos:** `./dev.sh test` roda tudo (pytest com cobertura, oxlint, Vitest com cobertura, checagem de tipos e build). No dia a dia: `uv run pytest -q` e `npm run test:watch`.
- **CI:** `.github/workflows/tests.yml` roda as mesmas etapas a cada push e pull request, sem GPU e sem Ollama.
- **Ainda sem testes automatizados:** páginas inteiras (`pages/`), o player com wavesurfer, o gravador e o microfone (dependem de APIs de áudio do navegador). São conferidos à mão no navegador.

## 14. Decisões de arquitetura

| Decisão | Motivo |
| --- | --- |
| Fila única de GPU | Whisper e LLM juntos em 6 GB ficaram mais de 100x mais lentos. |
| Whisper sempre carregado; descarregado só para o LLM | Carregar leva ~7 s. |
| `qwen3.5:4b` como padrão | Cabe inteiro na GPU: 44 s contra 312 s do `qwen3:8b`. |
| Map-reduce na ata | Reuniões de 70 min (~60k caracteres) não cabem em 8k tokens. |
| Recuperação lexical no chat (sem embeddings) | Simples, rápida, sem outro modelo na GPU, e boa o bastante para uma reunião. |
| Vite em vez de Next.js | O FastAPI já é o servidor; tudo sobe com um comando. |
| SQLite | Uso local e de um único usuário. |
| SSE para jobs, NDJSON para chat, WebSocket para ao vivo | Cada canal tem a direção e o formato de que precisa. |

## 15. Evolução planejada

**Quem está falando** (RF-11): novo port `SpeakerIdentifier`, coluna `segment.speaker`, tabela de vozes cadastradas e uma etapa após a transcrição. Desenho e plano TDD em [PLANO-VOZ.md](PLANO-VOZ.md).
