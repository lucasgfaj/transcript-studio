# Transcript Studio

App web local para importar, gravar, transcrever e gerar atas de reuniões. O backend é FastAPI e o frontend é React. Tudo roda no próprio computador, com Ollama para o modelo de linguagem e faster-whisper para a transcrição.

Todas as fases do [plano](docs/PLANO.md) estão prontas (0 a 8).

## Como usar

**Pelo Windows:** dê dois cliques em `Transcript Studio.bat` (dá para copiar para a Área de Trabalho). O navegador abre sozinho em http://localhost:8000. Para parar, feche a janela.

**Pelo terminal do WSL:**

```bash
cd ~/transcript-studio
./dev.sh start      # compila a interface e sobe tudo em http://localhost:8000
```

Antes, abra o **Ollama** no Windows (ele gera as atas e responde o chat). A transcrição não depende dele.

Outros comandos:

| Comando | Para quê |
| --- | --- |
| `./dev.sh` | Desenvolvimento: API com recarga em :8000 e interface com hot reload em http://localhost:5173 |
| `./dev.sh test` | Testes do backend, checagem de tipos e build da interface |
| `./dev.sh build` | Só compila a interface |
| `cd backend && uv run python -m transcript_studio.services.importer ~/transcript-mk` | Importa reuniões e contexto do projeto antigo (só copia; rodar de novo não duplica) |

Na primeira vez, o `dev.sh` instala as dependências sozinho. Pré-requisitos no WSL: [uv](https://docs.astral.sh/uv/) e Node (via nvm). Configurações opcionais estão em `backend/.env.example`.

### Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| "Ollama offline" na barra lateral | Abrir o Ollama no Windows. O WSL precisa da rede espelhada: `networkingMode=mirrored` em `C:\Users\<você>\.wslconfig`, seguido de `wsl --shutdown`. |
| Ao vivo grava, mas não aparece texto | Usar **Encontrar meu microfone**. No Windows: Privacidade → Microfone → permitir aplicativos da área de trabalho. |
| Ata ou chat muito lentos | Em **Modelos**, usar um modelo marcado "Cabe inteiro na GPU" (qwen3.5:4b). Com o notebook na tomada, a GPU fica mais rápida. |
| Primeira transcrição demora | O Whisper carrega quando o servidor sobe (~10 s); modelos novos do Whisper baixam no primeiro uso. |
| Script no Windows demora 21 s para conectar | Usar `127.0.0.1` em vez de `localhost` (o Windows tenta IPv6 primeiro). Navegadores não têm esse problema. |

## Chat com a reunião (fase 7)

Na aba **Chat** da reunião, pergunte qualquer coisa ("o que foi dito sobre a comissão?", "liste as tarefas"). A resposta vem do modelo local, em streaming, com base na ata e nos trechos da transcrição. Cada horário citado, como **[33:35]**, é um botão que toca o áudio a partir dali. A conversa fica salva por reunião e pode ser apagada.

Como funciona:
- **Busca de trechos** (`services/retrieval.py`): uma reunião de 70 min tem ~60 mil caracteres e não cabe na janela de 8 mil tokens do modelo. A transcrição vira passagens de ~1.000 caracteres, pontuadas pelas palavras raras da pergunta (sem acento, sem palavras vazias). Até 9 mil caracteres das melhores vão em ordem cronológica, com o horário de cada frase. Perguntas sem tema ("resuma") recebem trechos espalhados do começo ao fim.
- **Horários confiáveis:** modelos pequenos inventam segundos dentro de um segmento de 30 s. Antes de salvar, cada citação é ajustada para o início do segmento que a contém (em teste real, 17 de 19 horários brutos não existiam; depois do ajuste, 0).
- **GPU:** a resposta espera a tarefa em andamento terminar (e avisa), tira o Whisper da GPU e bloqueia novas tarefas até acabar. Durante uma gravação ao vivo o chat não roda.
- **Parar:** o botão Parar corta o stream do Ollama na hora, e a resposta parcial fica salva como "interrompida".

Medido na reunião de 70 min com qwen3.5:4b: **primeiro token em ~1 s**, resposta completa em 6 a 20 s.

## Modelos e contexto (fase 6)

- **Modelos:** lista o que está instalado no Ollama e marca o que cabe inteiro na GPU de 6 GB e o que roda em parte na CPU (bem mais lento). Também mostra o que está carregado agora.
  - Escolhe o modelo padrão da ata e apaga modelos (o padrão é protegido).
  - Baixa modelos sugeridos, ou qualquer um da biblioteca do Ollama, com barra de progresso.
  - Troca o tamanho do Whisper. A troca passa pela fila de GPU, então uma transcrição em andamento termina com o modelo com que começou.
- **Contexto:** edita os arquivos Markdown de `data/context/` (glossário, pessoas, empresas), cria e apaga. Mostra quantos caracteres vão para o prompt, quais arquivos ficaram de fora por falta de espaço, e permite ajustar o limite (1.000 a 12.000).
- As escolhas ficam no banco (tabela `appsetting`) e passam por cima dos valores de `core/config.py`.

## Ao vivo (fase 5)

Em **Ao vivo**, grave pelo microfone e veja o texto aparecer a cada pausa na fala. O áudio é gravado no servidor enquanto você fala, então fechar a aba ou cair a conexão não perde nada. Ao parar, a reunião é salva com áudio e transcrição com horários. Depois dá para usar "Transcrever de novo" no modo Detalhado e gerar a ata.

Teste com 2 minutos de uma reunião real enviados em tempo real (RTX 4050): 27 trechos, **texto em mediana 1,4 s depois da pausa** (pior caso 8,3 s num trecho longo sem pausa).

Como funciona:
- O navegador captura com um **AudioWorklet**, converte para 16 kHz mono PCM16 e envia blocos de 250 ms por WebSocket (`/api/live`).
- O servidor corta a fala em **pausas** de 0,6 s (`services/live_segmenter.py`). Mínimo de 2 s, e um corte forçado a cada 15 s no ponto mais silencioso. Silêncio não vai para o Whisper, o que evita frases inventadas.
- Cada trecho vai para o Whisper com as últimas frases como contexto, para manter nomes e grafia.
- Enquanto grava, a **fila de GPU pausa**: tarefas novas esperam, e o Ollama é descarregado.

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
| WS | `/api/live` (gravação ao vivo; protocolo documentado em `controllers/live.py`) |
| GET | `/api/models` (instalados, catálogo, Whisper) · POST `/api/models/pull` (progresso NDJSON) · DELETE `/api/models/{nome}` |
| GET / PUT | `/api/preferences` (modelo padrão da ata, Whisper, limite do contexto) |
| GET | `/api/context` · GET / PUT / DELETE `/api/context/file?path=` |
| GET / POST / DELETE | `/api/meetings/{id}/chat` (histórico; pergunta com resposta em NDJSON: status, token, done, error; limpar) |
| GET | `/api/health` (status do Ollama e da fila de GPU) |

A documentação interativa fica em http://localhost:8000/docs.
