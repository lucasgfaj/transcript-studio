# Transcript Studio: plano

Projeto novo em `~/transcript-studio`, que aproveita o código do `~/transcript-mk` sem alterá-lo. É um app web local para importar, gravar e transcrever reuniões e gerar a ata. Tudo roda no próprio PC: FastAPI no backend, Ollama para o modelo de linguagem e faster-whisper para a transcrição.

## 1. O que existe hoje (transcript-mk)

| Peça | Estado | Vai para o novo projeto? |
| --- | --- | --- |
| `ChunkedMinutesGenerator` (map-reduce do prompt da ata) | Funciona e tem testes | Sim, sem mudanças na lógica |
| `OllamaMinutesGenerator` (`/api/chat`, `think: false`, `num_ctx`) | Funciona | Sim, com streaming de tokens |
| `FasterWhisperTranscriber` (GPU, VAD, carrega as libs CUDA do pip) | Funciona | Sim, mais o modo em lote e os timestamps |
| `GroqResponsesMinutesGenerator` / `GroqAudioTranscriber` | Funciona | Sim, como provedor opcional |
| `MarkdownContextRepository` (pasta `contexto/`) | Funciona | Sim, com CRUD pela interface |
| Página Gradio (`web.py`) | Protótipo | Não; vira o frontend React |
| Arquivos soltos em `reunioes/` e `storage/` | 8 áudios, ~225 min | Importados para o novo banco (cópia, não move) |

Problemas que o novo projeto precisa resolver:
- Não há banco de dados. Cada reunião é uma pasta e não dá para listar, buscar, editar nem apagar pela interface.
- A transcrição não guarda os timestamps, então não dá para clicar no texto e pular para aquele ponto do áudio.
- Whisper e Ollama disputam a mesma GPU sem coordenação (detalhes na seção 4).

## 2. Seu hardware (medido)

| Item | Valor | O que isso significa |
| --- | --- | --- |
| CPU | Intel Core 5 210H, 12 threads | Não é um "Core Ultra" e não tem NPU. A aceleração útil é a GPU. |
| RAM | 16 GB DDR5 (7,6 GB visíveis no WSL) | O WSL só enxerga metade. Dá para aumentar no `.wslconfig` (`memory=12GB`). |
| GPU | RTX 4050 Laptop, 6 GB VRAM | É o gargalo principal: Whisper e LLM não cabem juntos com folga. |
| Disco | 948 GB livres no WSL | Sem preocupação. |

Medições já feitas:
- **Whisper large-v3-turbo sozinho na GPU:** 2,9 min de áudio em 3 s, ou seja, cerca de 60x mais rápido que o tempo real.
- **Ata com `qwen3:8b`:** 40 a 50 s para uma transcrição curta. O modelo ocupa 6,6 GB e roda 37% na CPU porque não cabe na GPU.
- **Whisper e Ollama ao mesmo tempo:** a VRAM encheu (5,7 de 6 GB) e um teste de 10 min de áudio não terminou em 10 min. Disputar a GPU deixa tudo mais de 100x mais lento.

## 3. Arquitetura

```text
Navegador (React)  ──HTTP/SSE/WebSocket──▶  FastAPI  ──▶  Fila de GPU (1 trabalho por vez)
   shadcn + Tailwind                          │              ├─ faster-whisper (fica carregado)
   player com waveform                        │              └─ Ollama  http://localhost:11434
   chat com a reunião                         ├─ SQLite (reuniões, segmentos, atas, chat, jobs)
                                              └─ data/meetings/<id>/  (áudio original + exportações)
```

### Backend: `backend/` (Python 3.12, uv, FastAPI, SQLModel)

Organizado em MVC + SOLID. A tabela de princípios está no README.

```text
backend/src/transcript_studio/
  main.py              # cria o app, monta /api e serve o frontend compilado
  core/                # config (pydantic-settings), db (SQLite), dependencies.py (composition root)
  controllers/         # Controller: rotas HTTP, sem regra de negócio
  schemas/             # contratos de entrada e saída da API
  services/            # regras de negócio: meetings, documents, importer
                       #   próximas fases: transcription, minutes (streaming), gpu_queue, chat
  domain/              # ports.py (Protocols) e errors.py
  models/              # Model: tabelas SQLModel
  repositories/        # implementação SQL dos ports
  infrastructure/      # áudio em disco, waveform, cliente Ollama
                       #   próximas fases: faster-whisper, Ollama com streaming, Groq
backend/tests/
```

**Modelo de dados**

| Tabela | Campos principais |
| --- | --- |
| `meeting` | id, título, participantes, data, idioma, origem (import/gravação/ao vivo), status, áudio, duração, criado/atualizado |
| `segment` | meeting_id, ordem, início, fim, texto (permite clicar e pular no áudio e exportar SRT) |
| `minutes` | meeting_id, markdown, modelo, criado em (cada vez que gerar de novo vira uma nova versão) |
| `chat_message` | meeting_id, papel, conteúdo |
| `job` | id, meeting_id, tipo, status, progresso, erro |
| `setting` | LLM padrão, Whisper padrão, num_ctx, idioma padrão |

**API**

| Método | Rota | Para quê |
| --- | --- | --- |
| GET / POST | `/api/meetings` | Listar (com busca e filtro) e criar |
| GET / PATCH / DELETE | `/api/meetings/{id}` | Ver, editar dados e apagar (inclui os arquivos) |
| POST | `/api/meetings/{id}/audio` | Enviar áudio (qualquer formato que o PyAV lê: wav, mp3, m4a, ogg, webm) |
| GET | `/api/meetings/{id}/audio` | Tocar o áudio no player, com suporte a avançar e voltar (Range) |
| POST | `/api/meetings/{id}/transcribe` | Criar o job de transcrição; o progresso chega por SSE em `/api/jobs/{id}/events` |
| GET / PUT | `/api/meetings/{id}/transcript` | Segmentos com timestamps; editar o texto |
| POST | `/api/meetings/{id}/minutes` | Gerar a ata com streaming de tokens (SSE) |
| GET / PUT | `/api/meetings/{id}/minutes` | Versão atual, histórico e edição |
| POST | `/api/meetings/{id}/chat` | Perguntar sobre a reunião, com resposta em streaming |
| GET | `/api/meetings/{id}/export?format=md\|txt\|srt\|docx` | Exportar |
| WS | `/api/live` | O navegador manda áudio PCM e o servidor devolve o texto parcial |
| GET / POST / DELETE | `/api/models` | Modelos do Ollama: listar, baixar (progresso por SSE), apagar e escolher o padrão |
| GET / PUT | `/api/context` | Editar o glossário e o contexto de pessoas e empresas |

### Frontend: `frontend/` (Vite, React 19, TypeScript, Tailwind v4, shadcn/ui)

Recomendo **Vite em vez de Next.js**. O app é local e o FastAPI já faz o papel de servidor. O Vite gera arquivos estáticos que o próprio FastAPI serve, então tudo sobe com um único comando. A diretiva `"use client"` do `agent-chat.tsx` é ignorada fora do Next e não causa problema.

- **Setup:** `npm create vite@latest frontend -- --template react-ts`, depois Tailwind v4 (`@tailwindcss/vite`) e `npx shadcn@latest init`.
- **Pasta dos componentes:** o shadcn usa `src/components/ui` com o alias `@/components/ui`, definido no `components.json` e no `tsconfig`. Essa pasta precisa existir com esse alias: o `shadcn add` instala os componentes ali, e o `agent-chat.tsx` e o demo importam de `@/components/ui/agent-chat`. Em outro lugar, os imports quebram.
- **Dependências:** `clsx`, `tailwind-merge`, `lucide-react`, `@tanstack/react-query`, `react-router`, `wavesurfer.js` (waveform e player), `react-markdown` com `remark-gfm` (preview da ata) e `sonner` (avisos).
- **Componentes shadcn:** button, card, input, textarea, dialog, dropdown-menu, tabs, table, badge, progress, sheet, sidebar, skeleton, sonner, command (busca com Ctrl+K).

**Telas**

1. **Biblioteca:** tabela ou cards com as reuniões, busca, filtros por status e data, e ações de abrir, renomear e apagar.
2. **Nova reunião:** arrastar um arquivo, gravar pelo navegador (MediaRecorder) ou entrar no modo ao vivo.
3. **Reunião:**
   - player com waveform no topo;
   - abas Transcrição (segmentos com horário; clicar pula o áudio; o trecho atual fica destacado), Ata (editor com preview, histórico e botão de gerar de novo), Chat e Detalhes;
   - barra de progresso ao vivo enquanto transcreve.
4. **Modelos:** o que está instalado, o que está carregado na GPU, baixar um modelo novo com barra de progresso, escolher o padrão e o modelo do Whisper.
5. **Contexto:** editor do glossário e das fichas de pessoas e empresas usadas no prompt.

**Onde entra o `AgentChat`:** na aba Chat da reunião, para perguntar coisas como "quais tarefas ficaram com a Ana?" a partir da transcrição e da ata.

| Prop | De onde vem |
| --- | --- |
| `messages` | `chat_message` do banco, convertido para `AgentMessage` com uma parte do tipo `text` |
| `status` | `submitted` → `streaming` → `ready`, conforme o fetch com streaming |
| `onSend` | `POST /api/meetings/{id}/chat` |
| `onStop` | `AbortController` do fetch |
| `error` | erro do Ollama, por exemplo modelo ausente ou servidor fora do ar |
| `attachments` | não usado nesta versão (a prop é opcional) |

O componente não precisa de imagens, contexto global nem providers. Os ícones SVG embutidos podem continuar assim ou virar ícones do `lucide-react` (`ArrowUp`, `Square`, `Paperclip`, `X`, `File`) para combinar com o resto do app. Ele ocupa a altura inteira do pai, então fica dentro de um container com `h-full` ou `flex-1 min-h-0`.

**Visual:** tema claro e escuro, sidebar recolhível, fonte Geist ou Inter, cores neutras com um acento, layout que funciona também no celular, skeletons enquanto carrega e atalhos de teclado.

## 4. Como deixar a transcrição mais rápida no seu PC

Em ordem de impacto:

1. **Fila única de GPU:** nunca rodar Whisper e Ollama ao mesmo tempo. É o ganho mais importante, porque evita a lentidão de mais de 100x medida acima. O worker transcreve; antes da ata, descarrega o Whisper ou pede ao Ollama para liberar a GPU (`keep_alive: 0`).
2. **Whisper sempre carregado:** carregar o modelo leva cerca de 7 s. O worker carrega uma vez e reaproveita.
3. **Modo em lote para arquivos:** o `BatchedInferencePipeline` do faster-whisper (com `batch_size` entre 8 e 16) costuma ser várias vezes mais rápido em áudios longos. Vou medir no seu PC (com a GPU livre) e usar o melhor valor como padrão.
4. **Configuração do Whisper:** `large-v3-turbo` com `int8_float16` e VAD (pula os silêncios). Um modo "rápido" com `beam_size=1` fica como opção.
5. **Modelo de linguagem que cabe inteiro na GPU:** o `qwen3.5:4b` (3,3 GB, você já tem) cabe nos 6 GB, ao contrário do `qwen3:8b`, que roda 37% na CPU. Vou comparar a qualidade das duas atas e escolher o padrão.
6. **Ajustes do Ollama no Windows:** `OLLAMA_FLASH_ATTENTION=1` e `OLLAMA_KV_CACHE_TYPE=q8_0` reduzem a memória do contexto, sobrando mais espaço na GPU para o modelo.
7. **Ao vivo:** usar o VAD para cortar nas pausas da fala, em vez de blocos fixos de 6 s. O texto aparece mais rápido e sem palavras cortadas. Ao final, uma passada em lote sobre a gravação inteira melhora a versão final.
8. **No notebook:** ligado na tomada e com o modo de desempenho máximo da NVIDIA. Na bateria, a GPU perde bastante velocidade.

## 5. Fases

| Fase | Entrega | Pronto quando |
| --- | --- | --- |
| 0. Estrutura ✅ | Pastas, uv, Vite, Tailwind, shadcn, `agent-chat.tsx` em `src/components/ui`, script `dev.sh` | `./dev.sh` sobe a API e o front, e a página do demo aparece |
| 1. Banco e CRUD ✅ | Tabelas, CRUD de reuniões, upload e player de áudio, importação do transcript-mk | As 8 reuniões antigas aparecem na Biblioteca com áudio tocando |
| 2. Transcrição ✅ | Fila de GPU, jobs, SSE, modo em lote, timestamps, benchmark | Feito: 70 min em 82 s com progresso e texto ao vivo (ver README) |
| 3. Ata ✅ | Streaming de tokens, editor, histórico, exportar md/docx/txt/srt | Feito: ata de 32 min em 44 s com qwen3.5:4b, com texto ao vivo e histórico |
| 4. Interface ✅ | Biblioteca, página da reunião, transcrição clicável, tema escuro, Ctrl+K, busca na transcrição, atalhos, fila da GPU | Feito: fluxo completo pela interface, também no celular |
| 5. Gravação e ao vivo ✅ | MediaRecorder, WebSocket com corte nas pausas, fila de GPU pausada | Feito: texto ~1,4 s após cada pausa, áudio salvo durante a gravação |
| 6. Modelos e contexto | Tela de modelos (baixar, apagar, padrão), editor de contexto | Baixar um modelo novo pela interface e usá-lo na ata |
| 7. Chat | `AgentChat` ligado ao Ollama com o contexto da reunião | Perguntar sobre a reunião e receber a resposta em streaming |
| 8. Acabamento | Testes, README, um comando para subir tudo | `pytest` e o build do front passam |

## 6. Decisões em aberto

1. **Nome e pasta:** `~/transcript-studio`, ou prefere outro nome?
2. **Frontend:** Vite (recomendado) ou Next.js?
3. **Login:** o app é para uso só seu e local, sem login? Ou outras pessoas da rede vão acessar?
4. **Groq:** manter como opção alternativa ou deixar 100% local?
5. **Git:** criar um repositório novo no GitHub ou manter só local por enquanto?
