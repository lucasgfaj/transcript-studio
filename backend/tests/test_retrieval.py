from __future__ import annotations

from transcript_studio.services.retrieval import Passage, fold, passages, select, terms


def test_terms_ignore_accents_case_and_stop_words() -> None:
    assert terms("Qual foi a decisão sobre o ORÇAMENTO da obra?") == ["decisao", "orcamento", "obra"]
    assert fold("Comissão") == "comissao"


def test_passages_keep_the_start_time_of_their_first_segment() -> None:
    segments = [(0.0, "a" * 600), (10.0, "b" * 600), (20.0, "c" * 100)]
    result = passages(segments, size=1_000)
    assert [p.start for p in result] == [0.0, 20.0]


def test_select_prefers_passages_about_the_question_in_order() -> None:
    candidates = [
        Passage(0, "Abertura e apresentação da equipe " * 10),
        Passage(60, "O orçamento da obra do residencial foi aprovado em 2 milhões " * 5),
        Passage(120, "Discussão sobre o loteamento e o VGV " * 10),
        Passage(180, "Carla fica responsável por revisar o orçamento até sexta " * 5),
    ]
    chosen = select("O que decidiram sobre o orçamento?", candidates, budget=700)
    assert [p.start for p in chosen] == [60, 180]


def test_select_without_topic_words_spreads_over_the_meeting() -> None:
    candidates = [Passage(i * 60, f"trecho {i} " + "x" * 990) for i in range(20)]
    chosen = select("resuma", candidates, budget=5_000)
    assert [p.start for p in chosen] == [0, 240, 480, 720, 960]  # every 4th passage, start to end


def test_short_transcripts_are_sent_whole() -> None:
    candidates = [Passage(0, "curto")]
    assert select("qualquer coisa", candidates, budget=1_000) == candidates
