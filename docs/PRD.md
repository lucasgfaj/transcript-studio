# Transcript Studio: PRD (requisitos do produto)

| | |
| --- | --- |
| **Produto** | Transcript Studio |
| **Versão do documento** | 1.0 (estado após a Fase 8 + prompt da ata com Objetivo) |
| **Data** | 2026-10-23 |
| **Relacionados** | [SDD](SDD.md) · [Plano original](PLANO.md) · [Plano: reconhecimento de voz](PLANO-VOZ.md) · [README](../README.md) |

---

## 1. Visão

Um app web **100% local** que transforma o áudio de uma reunião em transcrição com horários, ata e respostas a perguntas, sem que nenhum dado saia do computador. A transcrição usa o faster-whisper na GPU; a ata e o chat usam um modelo local do Ollama.

## 2. Problema

O protótipo anterior (`transcript-mk`) transcrevia e gerava atas, mas:

- **não tinha banco de dados**: cada reunião era uma pasta solta, sem listar, buscar, editar ou apagar pela interface;
- **não guardava horários**: não dava para clicar no texto e ouvir o trecho;
- **Whisper e Ollama disputavam a GPU** de 6 GB sem coordenação, deixando tudo mais de 100x mais lento;
- a interface era um protótipo em Gradio.

Serviços de transcrição na nuvem resolvem parte disso, mas enviam o conteúdo das reuniões para terceiros e cobram por minuto.

## 3. Usuário e contexto de uso

| Item | Descrição |
| --- | --- |
| **Usuário** | Quem participa de muitas reuniões e precisa de registro, ata e tarefas. Uso individual, sem login. |
| **Ambiente** | Notebook Windows + WSL (Ubuntu), GPU NVIDIA RTX 4050 Laptop 6 GB, 16 GB de RAM. |
| **Acesso** | Navegador em `http://localhost:8000`, também no celular. |
| **Idioma** | Português do Brasil (interface, prompts e transcrição padrão). |

## 4. Objetivos e métricas

| Objetivo | Métrica | Meta | Medido |
| --- | --- | --- | --- |
| Transcrição rápida | 70 min de áudio, modo Rápido | < 2 min | 82 s |
| Ata rápida e na GPU | Reunião de 32 min | < 1 min | 44 s (`qwen3.5:4b`) |
| Chat responsivo | Primeiro token | ≤ 2 s | ~1 s |
| Ao vivo útil | Texto após uma pausa na fala | ≤ 2 s | mediana 1,4 s |
| Privacidade | Dados enviados para fora da máquina | 0 | 0 |
| Confiabilidade | Gravação perdida ao fechar a aba | nunca | áudio salvo durante a gravação |
| Simplicidade | Comandos para subir | 1 | `./dev.sh start` ou o `.bat` |

## 5. Escopo

### 5.1 Dentro do escopo

Biblioteca com busca; importação de áudio e gravação; ao vivo; transcrição com horários clicáveis; ata por IA com versões; exportação; chat com a reunião; gestão de modelos e de contexto; importação do projeto antigo.

### 5.2 Fora do escopo nesta versão

- Login e múltiplos usuários.
- Provedores na nuvem (Groq ou outros).
- Chat entre várias reuniões.
- Backup automático de `data/`.
- Integração com calendário, Teams, Meet ou Zoom.
- **Identificação de quem fala**: planejada em [PLANO-VOZ.md](PLANO-VOZ.md) (RF-11).

## 6. Requisitos funcionais

Prioridade: **P0** essencial, **P1** importante, **P2** desejável. Situação: ✅ implementado, 🗓️ planejado.

### RF-1 Biblioteca

| ID | Requisito | P | |
| --- | --- | --- | --- |
| RF-1.1 | Listar reuniões com título, data, participantes, duração e status. | P0 | ✅ |
| RF-1.2 | Buscar por título, participantes ou algo dito na transcrição. | P0 | ✅ |
| RF-1.3 | Filtrar por status. | P1 | ✅ |
| RF-1.4 | Editar dados e apagar a reunião (com os arquivos). | P0 | ✅ |
| RF-1.5 | Busca global com `Ctrl+K`. | P1 | ✅ |

### RF-2 Criar reunião

| ID | Requisito | P | |
| --- | --- | --- | --- |
| RF-2.1 | Enviar áudio em qualquer formato que o PyAV lê (wav, mp3, m4a, ogg, webm…). | P0 | ✅ |
| RF-2.2 | Criar a reunião e enviar o áudio em uma ação. | P1 | ✅ |
| RF-2.3 | Gravar pelo microfone do navegador. | P0 | ✅ |
| RF-2.4 | Importar reuniões e contexto do `transcript-mk` sem alterar os originais nem duplicar. | P1 | ✅ |

### RF-3 Ao vivo

| ID | Requisito | P | |
| --- | --- | --- | --- |
| RF-3.1 | Mostrar o texto a cada pausa natural na fala. | P0 | ✅ |
| RF-3.2 | Salvar o áudio no servidor durante a gravação; fechar a aba não perde nada. | P0 | ✅ |
| RF-3.3 | Avisar sobre silêncio digital do microfone (> 4 s) e ajudar a achar o microfone certo. | P1 | ✅ |
| RF-3.4 | Pausar a fila de GPU durante a gravação. | P0 | ✅ |

### RF-4 Transcrição

| ID | Requisito | P | |
| --- | --- | --- | --- |
| RF-4.1 | Transcrever na GPU guardando início e fim de cada trecho. | P0 | ✅ |
| RF-4.2 | Modo **Rápido** (lote, ~75x) e **Detalhado** (sequencial, ~32x, frase a frase). | P0 | ✅ |
| RF-4.3 | Mostrar progresso e texto enquanto transcreve. | P0 | ✅ |
| RF-4.4 | Cancelar transcrição em andamento ou na fila. | P1 | ✅ |
| RF-4.5 | Clicar no horário pula o player; o trecho atual fica destacado. | P0 | ✅ |
| RF-4.6 | Editar o texto da transcrição. | P1 | ✅ |
| RF-4.7 | Buscar na transcrição ignorando acentos. | P1 | ✅ |

### RF-5 Player

| ID | Requisito | P | |
| --- | --- | --- | --- |
| RF-5.1 | Forma de onda e avanço/retrocesso (HTTP Range). | P0 | ✅ |
| RF-5.2 | Atalhos: `Espaço`, `←`/`→` 5 s, `Shift+←`/`→` 30 s. | P2 | ✅ |

### RF-6 Ata

| ID | Requisito | P | |
| --- | --- | --- | --- |
| RF-6.1 | Gerar a ata com IA local, em streaming. | P0 | ✅ |
| RF-6.2 | Modelo fixo: **Objetivo** (propósito real, deduzido da discussão), Resumo (resultado frente ao objetivo), Tópicos, Decisões, Tarefas (responsável e prazo), Pendências e riscos, Próximos passos. | P0 | ✅ |
| RF-6.3 | Responsável ou prazo não ditos aparecem como "não definido", nunca inventados. | P0 | ✅ |
| RF-6.4 | Reuniões longas: notas por parte com rótulos (OBJETIVO, FATO, DECISÃO, TAREFA, PENDÊNCIA) e consolidação final. | P0 | ✅ |
| RF-6.5 | Escolher o modelo na hora de gerar. | P1 | ✅ |
| RF-6.6 | Editar; cada geração ou edição vira uma versão restaurável. | P0 | ✅ |
| RF-6.7 | Só fatos da transcrição; o contexto serve apenas para grafar nomes, sem ser citado. | P0 | ✅ |

### RF-7 Exportação

| ID | Requisito | P | |
| --- | --- | --- | --- |
| RF-7.1 | Ata em `.docx` e `.md`. | P0 | ✅ |
| RF-7.2 | Transcrição em `.txt` e legendas `.srt`. | P1 | ✅ |

### RF-8 Chat com a reunião

| ID | Requisito | P | |
| --- | --- | --- | --- |
| RF-8.1 | Perguntas sobre uma reunião com resposta em streaming. | P0 | ✅ |
| RF-8.2 | Usa a ata e os trechos relevantes, mesmo em reuniões longas. | P0 | ✅ |
| RF-8.3 | Horários citados (ex.: **[33:35]**) são botões e sempre apontam para o início de um trecho real. | P0 | ✅ |
| RF-8.4 | **Parar** interrompe; a parte gerada é salva como interrompida. | P1 | ✅ |
| RF-8.5 | Histórico salvo por reunião, com opção de limpar. | P1 | ✅ |
| RF-8.6 | Quando a resposta não está no material, o modelo diz isso. | P0 | ✅ |

### RF-9 Modelos e contexto

| ID | Requisito | P | |
| --- | --- | --- | --- |
| RF-9.1 | Listar modelos do Ollama indicando quais cabem inteiros na GPU. | P1 | ✅ |
| RF-9.2 | Baixar (com progresso) e apagar modelos. | P1 | ✅ |
| RF-9.3 | Escolher o LLM padrão e o tamanho do Whisper. | P1 | ✅ |
| RF-9.4 | CRUD de arquivos Markdown de contexto (glossário, pessoas, empresas). | P1 | ✅ |
| RF-9.5 | Mostrar o tamanho do contexto no prompt e o que ficou de fora. | P2 | ✅ |
| RF-9.6 | Preferências no banco, com prioridade sobre o `.env`. | P1 | ✅ |

### RF-10 Fila de GPU e sistema

| ID | Requisito | P | |
| --- | --- | --- | --- |
| RF-10.1 | Um trabalho de GPU por vez, com fila e progresso na barra lateral. | P0 | ✅ |
| RF-10.2 | Mostrar se o Ollama está online. | P1 | ✅ |
| RF-10.3 | Tema claro/escuro e layout para celular. | P1 | ✅ |

### RF-11 Quem está falando (planejado)

Detalhes, decisões em aberto e plano TDD em [PLANO-VOZ.md](PLANO-VOZ.md).

| ID | Requisito | P | |
| --- | --- | --- | --- |
| RF-11.1 | Cadastrar a voz de cada participante frequente com uma leitura guiada de ~60 s de um texto de parametrização, mostrando o reconhecimento da voz enquanto ela fala. | P1 | 🗓️ |
| RF-11.2 | Após a transcrição, atribuir a cada trecho o nome da voz mais parecida ou "Desconhecido". | P1 | 🗓️ |
| RF-11.3 | Mostrar o nome na transcrição e permitir corrigi-lo à mão. | P1 | 🗓️ |
| RF-11.4 | Ata e chat recebem a transcrição com quem falou, para acertar responsáveis. | P1 | 🗓️ |
| RF-11.5 | Exportações `.txt` e `.srt` incluem o nome de quem fala. | P2 | 🗓️ |

## 7. Requisitos não funcionais

| ID | Categoria | Requisito |
| --- | --- | --- |
| RNF-1 | Privacidade | Nenhum conteúdo sai da máquina; Whisper e Ollama rodam localmente. |
| RNF-2 | Privacidade | `data/`, `.env`, bancos, áudios e exportações nunca entram no Git. |
| RNF-3 | Desempenho | Metas da seção 4 em uma RTX 4050 6 GB. |
| RNF-4 | Desempenho | Whisper e LLM nunca usam a GPU ao mesmo tempo. |
| RNF-5 | Confiabilidade | Falha em um trabalho não derruba a fila nem o servidor; trabalhos interrompidos por reinício são retomados. |
| RNF-6 | Confiabilidade | A gravação ao vivo é persistida enquanto acontece. |
| RNF-7 | Usabilidade | Funciona sem configuração; um comando ou dois cliques para subir. |
| RNF-8 | Manutenibilidade | Regras de negócio dependem de interfaces (ports); trocar Whisper ou Ollama é criar outra implementação. |
| RNF-9 | Qualidade | Desenvolvimento orientado a testes (TDD); a suíte roda sem GPU e sem Ollama, com fakes. |
| RNF-10 | Portabilidade | Windows + WSL (Ubuntu) com GPU NVIDIA; navegador moderno. |

## 8. Fluxos principais

1. **Arquivo → ata**: Nova reunião → arrastar áudio → Transcrever → revisar pelos horários → Gerar ata → editar → Exportar `.docx`.
2. **Ao vivo**: Ao vivo → gravar → texto a cada pausa → parar → reunião salva com áudio e trechos → gerar ata.
3. **Pergunta**: reunião → Chat → "liste as tarefas" → clicar em **[12:34]** para ouvir.

## 9. Premissas e restrições

- O Ollama roda no Windows e é acessado do WSL por `localhost` com `networkingMode=mirrored`.
- 6 GB de VRAM não comportam Whisper `large-v3-turbo` e um LLM de 8B juntos; o padrão é `qwen3.5:4b`.
- O contexto do LLM é de 8k tokens; ata e chat trabalham dentro desse orçamento.
- O WSL enxerga metade da RAM por padrão.

## 10. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Modelo pequeno inventa fatos ou horários | Ata/chat incorretos | Prompts "só fatos explícitos" e "não definido"; horários citados ajustados ao início de um trecho real. |
| Whisper alucina em silêncio | Texto falso no ao vivo | Trechos silenciosos não vão ao Whisper. |
| Ollama fora do ar | Sem ata e chat | Status na barra lateral; a transcrição continua funcionando. |
| Perda de `data/` | Perda das reuniões | README orienta backup de `data/`. |
| Notebook na bateria | Tudo mais lento | Documentado em Problemas comuns. |

## 11. Próximos passos

1. Quem está falando (RF-11), conforme [PLANO-VOZ.md](PLANO-VOZ.md).
2. Chat entre várias reuniões.
3. Lista consolidada de tarefas entre reuniões.
4. Backup/exportação completa de `data/`.
