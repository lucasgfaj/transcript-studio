# Plano: quem está falando (reconhecimento de voz)

| | |
| --- | --- |
| **Requisitos** | RF-11 no [PRD](PRD.md) |
| **Arquitetura base** | [SDD](SDD.md) |
| **Situação** | Plano para iniciar; nada implementado. Decisões tomadas em 2026-10-23 (seção 5) |
| **Método** | TDD: cada passo começa por um teste que falha |

---

## 1. Objetivo

Hoje a transcrição diz **o que** foi dito, mas não **quem** disse. Com isso, a ata erra ou deixa em branco o responsável pelas tarefas. O objetivo é que cada trecho venha com o nome de quem fala:

```text
Ana    [12:34]  Eu fecho o orçamento até sexta.
Bruno  [12:41]  Então a gente aprova na próxima reunião.
```

As pessoas são cadastradas pela tela **Vozes**. Nomes e impressões de voz ficam só no banco local (`data/`), nunca no repositório.

## 2. Como funciona

São duas etapas: **identificação** (reconhecer pessoas cadastradas) e não apenas **diarização** (separar "Falante 1, Falante 2").

1. **Cadastro da voz:** cada pessoa tem uma "impressão de voz", um vetor (embedding) calculado a partir de uma **gravação separada**: a leitura guiada de ~60 s do texto de parametrização (ver abaixo), feita na tela **Vozes**. Também dá para enviar um arquivo. Mais de uma gravação por pessoa melhora a média (por exemplo, uma de perto e outra no microfone da sala).
2. **Identificação:** depois da transcrição, o áudio de cada trecho é cortado em janelas de ~1,5 s. Cada janela vira um embedding, comparado por **similaridade de cosseno** com as vozes cadastradas, desde que passe de um **limiar** (a calibrar, ~0,5). Abaixo do limiar, a janela fica como **"Desconhecido"**.
3. **Divisão por troca de voz:** quando a voz muda dentro de um trecho (comum no modo Rápido, que gera trechos do tamanho de parágrafos), o trecho é **dividido** no ponto da troca. O texto é repartido usando os horários de cada palavra do Whisper (`word_timestamps`), para cada parte ficar com o texto e o horário certos.
4. **Correção manual:** clicar no nome de um trecho permite trocar a pessoa.
5. **Uso:** a transcrição enviada à ata e ao chat passa a ter `Nome: texto`, então a ata pode preencher **Responsável** com segurança. As exportações `.txt` e `.srt` também levam o nome.

### Motor recomendado

| Opção | Prós | Contras |
| --- | --- | --- |
| **sherpa-onnx + modelo de embedding de voz (CAM++ ou WeSpeaker ResNet34, ~25–30 MB)** ✅ | Roda em **CPU** (não disputa a GPU com Whisper/Ollama), sem PyTorch, pacote pequeno, 100% local. Embedding de uma reunião de 1 h em segundos. | Só identifica (não faz diarização avançada com sobreposição). |
| pyannote.audio 3.x | Diarização de ponta, trata melhor fala sobreposta. | Exige PyTorch (~2 GB), token do Hugging Face para baixar o modelo e usa a GPU (fila mais longa). |
| SpeechBrain ECAPA | Boa precisão. | Também exige PyTorch. |

A proposta é começar com **sherpa-onnx em CPU**. O port `SpeakerEmbedder` permite trocar por pyannote depois sem mexer nas regras.

### Limitações conhecidas

- **Modo Rápido:** os trechos podem misturar duas pessoas; a divisão por troca de voz depende dos horários por palavra, que deixam a transcrição um pouco mais lenta (a medir no ciclo 6).
- Trocas de voz muito rápidas (< 1,5 s, como "isso", "certo") podem ficar com o falante vizinho.
- Fala sobreposta, microfone de sala com pessoas longe e vozes parecidas (parentes) reduzem o acerto.
- O ao vivo fica para depois: a primeira versão identifica só depois de transcrever.

### Parametrização da voz (leitura de 60 s)

O cadastro é uma **sessão guiada de ~60 s**. A pessoa lê o texto abaixo em voz alta, no tom normal de reunião, e a tela vai **reconhecendo a voz enquanto ela fala**:

1. A tela mostra o texto com a **frase atual destacada**. O áudio vai por WebSocket, como no ao vivo.
2. O servidor corta a fala nas pausas com o `LiveSegmenter` que já existe. Cada fala vira um embedding (CPU), que entra na média da voz.
3. Cada fala também passa pelo Whisper (a fila de GPU fica segurada durante a sessão, como no ao vivo). O texto reconhecido é comparado com o texto de leitura para **avançar o destaque** para a próxima frase, mesmo que a pessoa erre ou pule uma palavra.
4. A tela mostra o progresso: **segundos de fala útil** (meta: 45 s ou mais) e **estabilidade da voz**, que é a semelhança de cada fala nova com a média até ali. Quando os dois passam do mínimo, aparece **"Voz reconhecida"**.
5. Ao terminar, há um **teste**: a pessoa diz uma frase livre e a tela mostra quem o sistema reconheceu e com qual confiança. Se errar, dá para gravar de novo ou acrescentar outra leitura.

**Texto de parametrização** (~150 palavras, ~60 s em ritmo natural). Tem nasais, `lh`, `nh`, `rr`, `ç`, números, perguntas e exclamações, para cobrir sons e entonações variados, e termos que aparecem nas reuniões:

> 1. Bom dia. Meu nome é **[nome]** e estou gravando a minha voz para o Transcript Studio.
> 2. Hoje é um dia comum de trabalho, e a reunião começa às nove e meia em ponto.
> 3. Vamos revisar o orçamento de dois mil e vinte e seis, os contratos e as pendências da obra.
> 4. A diretoria, o financeiro e a equipe da obra precisam fechar os números até sexta-feira.
> 5. Você já conferiu a planilha de contas a receber? Acho que faltam três lançamentos.
> 6. Por favor, anote: o prazo é quinze de novembro, e o responsável por essa tarefa sou eu.
> 7. O jovem engenheiro trouxe o relatório, a chave da sala e um café bem quente.
> 8. Quando chove muito, o trânsito fica lento e todo mundo chega atrasado ao escritório.
> 9. Rápido, mas sem pressa: cada detalhe conta para a decisão final do grupo.
> 10. Ótimo! Então fica combinado assim, e a gente se fala na próxima semana. Obrigado a todos.

O texto fica em um arquivo (`backend/src/transcript_studio/services/enrollment_text.py`), com uma frase por item, para poder ser trocado sem mexer na lógica. O `[nome]` é preenchido com o nome da pessoa.

## 3. Desenho técnico

Segue a arquitetura do [SDD](SDD.md): regra de negócio em `services/`, dependendo de ports; implementações em `infrastructure/` e `repositories/`.

### 3.1 Ports novos (`domain/ports.py`)

```python
class SpeakerEmbedder(Protocol):
    """Turns a piece of 16 kHz mono audio into a voice vector."""
    def embed(self, samples: np.ndarray) -> np.ndarray: ...

class VoiceRepository(Protocol):
    def list(self) -> list[Voice]: ...
    def get(self, name: str) -> Voice | None: ...
    def save(self, voice: Voice) -> Voice: ...
    def delete(self, voice: Voice) -> None: ...
```

### 3.2 Dados

| Mudança | Detalhe |
| --- | --- |
| `segment.speaker: str \| None` | Nome atribuído (ou `None` = não identificado). |
| `segment.speaker_score: float \| None` | Similaridade da escolha, para mostrar a confiança e calibrar o limiar. |
| Nova tabela `voice` | `name` (PK), `embedding` (JSON com o vetor normalizado), `samples` (quantos trechos formaram a média), `seconds`, `created_at`, `updated_at`. |
| Migração leve em `core/db.py` | `create_all` não adiciona colunas a tabelas existentes: `PRAGMA table_info(segment)` + `ALTER TABLE segment ADD COLUMN …` se faltar. Não perde dados. |

Os embeddings ficam no `data/studio.db`, que já está fora do Git. Uma impressão de voz é um dado biométrico e não deve ir para o repositório.

### 3.3 Serviços

| Serviço | Responsabilidade |
| --- | --- |
| `services/speakers.py` → `match(embedding, voices, threshold)` | Função pura: devolve o nome mais parecido ou `None`. |
| `services/speakers.py` → `label_windows(audio, embedder, voices)` | Corta o áudio em janelas de 1,5 s e devolve o falante (ou `None`) de cada uma, suavizando trocas isoladas. |
| `services/speakers.py` → `split_by_speaker(segments, windows, words)` | Divide os trechos onde a voz muda, repartindo o texto pelos horários das palavras; devolve trechos novos com `speaker` e `score`. Trechos curtos (< 1 s) herdam o vizinho. |
| `services/voices.py` → `VoiceService` | Cadastrar a partir de uma gravação ou arquivo; acrescentar gravações (atualiza a média); renomear; apagar. |
| `TranscriptionJobHandler` | Nova etapa ao final: "Identificando quem fala". Só roda se houver vozes cadastradas e o idioma permitir. |
| Novo job `JobKind.speakers` | Reidentificar uma reunião já transcrita sem transcrever de novo (por exemplo, após cadastrar uma voz nova). |
| `MinutesJobHandler` / `ChatService` / `ExportService` | Usam `Nome: texto` quando há falante. |

### 3.4 API

| Método | Rota | Para quê |
| --- | --- | --- |
| GET | `/api/voices` | Listar vozes cadastradas |
| WS | `/api/voices/enroll` | Leitura guiada: `start {name}` → `ready {phrases}` → áudio PCM → `progress {phrase, speech_seconds, stability}` → `stop` → `saved {voice}`; depois `test` → `recognized {name, score}` |
| GET | `/api/voices/enrollment-text` | Frases do texto de parametrização |
| POST | `/api/voices` | Criar com um arquivo de áudio (multipart: `name` + arquivo) |
| POST | `/api/voices/{nome}/samples` | Acrescentar outra gravação da mesma pessoa |
| PATCH / DELETE | `/api/voices/{nome}` | Renomear / apagar |
| POST | `/api/meetings/{id}/speakers` | Reidentificar quem fala (job na fila, 202) |
| PATCH | `/api/meetings/{id}/segments/{idx}` | Corrigir o falante de um trecho: `{"speaker": "Bruno"}` |

### 3.5 Frontend

- **Tela Vozes:** lista de pessoas com quantos segundos de amostra; botão **Cadastrar voz**, que abre a leitura guiada de 60 s: texto com a frase atual destacada, medidor de nível (reaproveita `use-microphone`), barra de fala útil, indicador de estabilidade, **"Voz reconhecida"** e o teste final. Também envio de arquivo e botão de apagar.
- **Painel da transcrição:** nome antes do horário, uma cor por pessoa e menu para corrigir.
- Filtro "mostrar só falas do Fulano".
- Botão **Identificar quem fala** na barra de transcrição.

## 4. Plano TDD

Cada ciclo é **vermelho → verde → refatorar** e termina com `uv run pytest -q` passando e um commit. Os testes usam um `FakeSpeakerEmbedder` determinístico: cada "voz" sintética é um tom senoidal de frequência diferente, e o fake devolve um vetor derivado da frequência dominante. Assim a lógica é testada sem modelo real, como já se faz com o `FakeTranscriber`.

| # | Ciclo | Testes escritos primeiro (`backend/tests/`) | Implementação |
| --- | --- | --- | --- |
| 1 | Comparação de vozes | `test_speakers.py`: a voz mais parecida vence; abaixo do limiar → `None`; sem vozes cadastradas → `None`; vetores são normalizados. | `match()` com cosseno em numpy. |
| 2 | Rótulo por janela | Áudio só com a voz A → todas as janelas A; A depois B → troca no ponto certo (± 1 janela); uma janela isolada de B no meio de A é suavizada; silêncio → `None`. | `label_windows()` com janelas de 1,5 s. |
| 2b | Divisão de trechos | Trecho com uma voz → mantido, com o nome; trecho com A e depois B → dois trechos, texto repartido pelos horários das palavras, `start`/`end` contínuos e `idx` renumerado; parte < 1 s herda o vizinho; sem horários por palavra → nome da maioria, sem dividir. | `split_by_speaker()`; `FakeTranscriber` passa a devolver horários por palavra. |
| 3 | Migração do banco | `test_db_migration.py`: um banco antigo (sem `speaker`) sobe, ganha as colunas e mantém os trechos. | `_migrate()` em `core/db.py`; campos novos em `Segment`; modelo `Voice`. |
| 4 | Cadastro de vozes | `test_voices.py`: cadastrar com uma gravação gera o embedding; nova gravação atualiza a média; nome duplicado → 409; voz inexistente → 404; menos de 10 s de fala (descontado o silêncio) → 409 com mensagem clara; arquivo que não é áudio → 422. | `VoiceService`, `SqlVoiceRepository`; decodificação com PyAV para 16 kHz mono. |
| 5a | Leitura guiada (serviço) | `test_enrollment.py`: falas da mesma voz sobem a estabilidade; uma fala de outra voz no meio é sinalizada e não entra na média; o texto reconhecido avança a frase atual (tolerando palavras erradas, sem voltar); "Voz reconhecida" só com ≥ 45 s de fala e estabilidade acima do mínimo; parar antes disso não salva. | `EnrollmentSession` em `services/voices.py`, reaproveitando `LiveSegmenter`; comparação de texto sem acentos (`retrieval.fold`). |
| 5b | Leitura guiada (WebSocket) | `TestClient.websocket_connect("/api/voices/enroll")`: `ready` traz as frases com o nome preenchido; mensagens `progress` chegam a cada fala; `stop` salva a voz; `test` devolve `recognized`; a fila de GPU fica segurada durante a sessão e é liberada ao fechar. | `controllers/voices.py` (WS) + `enrollment_text.py`. |
| 5 | API de vozes | `TestClient`: `GET/POST/PATCH/DELETE /api/voices`, upload de amostra. | `controllers/voices.py`, `schemas/voice.py`, ligação em `dependencies.py`. |
| 6 | Etapa no job de transcrição | Com vozes cadastradas, a transcrição pede horários por palavra, e os trechos salvos vêm divididos e com `speaker`; sem vozes, a etapa é pulada e nada muda; um evento SSE `speakers` substitui os trechos ao final; cancelar durante a etapa cancela o job. | Etapa no `TranscriptionJobHandler`; `word_timestamps` no port `Transcriber`; `SpeakerEmbedder` no `Container` (fake injetável em `create_app`). Medir o custo dos horários por palavra no modo Rápido. |
| 7 | Reidentificar | `POST /meetings/{id}/speakers` cria job 202; sem transcrição → 409; sem vozes → 409; o texto completo da reunião não muda, só a divisão dos trechos e os nomes. | `JobKind.speakers` + handler (transcreve de novo só para obter os horários por palavra, se faltarem). |
| 8 | Correção manual | `PATCH …/segments/{idx}` troca o falante; nome inexistente → 422; `PUT …/transcript` (edição do texto) preserva os falantes. | Endpoint + `TranscriptService`. |
| 9 | Ata, chat e exportação | `FakeChat` recebe `Ana: …` no prompt da ata e do chat; `.txt` e `.srt` levam o nome; sem falantes, nada muda (testes atuais continuam passando). | Formatação da transcrição com falante em um único helper. |
| 10 | Motor real | `test_sherpa_embedder.py` marcado `@pytest.mark.slow`, pulado se o modelo não estiver baixado: dois trechos da mesma voz têm similaridade maior que trechos de vozes diferentes. | `infrastructure/speaker_embedder.py` (sherpa-onnx), download do modelo no primeiro uso, como o Whisper. |
| 11 | Calibração | Script `scripts/calibrate_speakers.py` (não é teste): com trechos rotulados à mão de 2–3 reuniões reais, mede o acerto por limiar e sugere o valor padrão. | `STUDIO_SPEAKER_THRESHOLD` em `config.py`. |
| 12 | Frontend | `tsc -b` e build passam; checagem manual do fluxo no navegador. | Tela Vozes com gravação, nome e cor no painel, correção, botão Identificar. |

### Critérios de pronto

- Todos os testes passam com `./dev.sh test` e continuam rodando **sem GPU e sem modelo de voz**.
- Em uma reunião real com as 6 pessoas cadastradas, pelo menos **85% dos trechos** com o nome certo (medido no ciclo 11), e o resto como "Desconhecido" em vez de um nome errado.
- A identificação de uma reunião de 1 h leva **menos de 1 min** em CPU e não atrasa a fila da GPU.
- A ata gerada passa a preencher o **Responsável** das tarefas com os nomes identificados.

## 5. Decisões

| Tema | Decisão (2026-10-23) |
| --- | --- |
| Motor | **sherpa-onnx em CPU**, sem PyTorch e sem disputar a GPU. |
| Cadastro | **Gravação separada** de cada pessoa (microfone na tela Vozes ou arquivo). |
| Modo Rápido | **Dividir os trechos** onde a voz muda já na v1. |
| Ao vivo | **Só depois** de transcrever na v1; identificar durante a gravação fica para uma próxima etapa. |
| Dados das pessoas | Nomes e vozes ficam só no banco local (`data/`); exemplos, testes e documentos usam nomes fictícios. |
