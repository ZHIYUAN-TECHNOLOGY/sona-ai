# Open datasets for the MiniCPM-o 4.5 fine-tune (Sona Care)

Researched 2026-10-01. Primary sources only: the Hugging Face Hub API (`cardData.license`, tags, `gated`, `lastModified`), dataset cards, the dataset viewer's row counts, GitHub LICENSE and README files, Kaggle metadata and papers. Each claim cites a source from the list at the end as `[S#]`. "Not stated" means no primary source I read says it. My own inferences are marked **judgement**. Row counts come from the Hugging Face dataset viewer unless a card is named. I downloaded only small text files, to count rows and check provenance. I downloaded no audio and no images, and I accepted no gating terms.

## Question

Which open datasets can fine-tune MiniCPM-o 4.5 (audio and image in, text and speech out) for Sona Care? Sona Care must:
- understand patients who speak Manglish (English, Malay and Mandarin mixed in one sentence);
- answer any medical question, not only questions about the patient's discharge plan, and everyday questions too;
- answer in English, Malay or Mandarin;
- read medicine boxes, strips and pharmacy labels.

Already in hand, so not listed again: our synthetic Manglish consultation audio (29 h), Gemini "Kore" clips (4.35 h), FLEURS ms/en/zh, the Revolab Malaysian ASR benchmark and Common Voice 22. PriMock57 and the Fareez OSCE audio are covered in [asr-training-data.md](asr-training-data.md) [S52].

**Licence policy (from the brief).** CC0, CC BY, MIT and Apache-2.0 data may train any model. Non-commercial or unlicensed data may train only the competition/demo model. That data is tagged, and the model is retrained without it before hospital use. In the tables, "Commercial?" means:
- **yes**: the stated licence allows commercial use and nothing I read contradicts it. CC BY-SA and ODC-BY are marked "yes (SA)" or "yes (attribution)". They are not on the policy list, so they need a decision (see [Open questions](#open-questions)).
- **no**: non-commercial, no-derivatives, research-only or AGPL terms, or a source whose terms forbid reuse.
- **unclear**: no licence, a card that contradicts its LICENSE or README, or a permissive tag on scraped third-party content. Treat as demo-only.

## TL;DR

- **Almost no Malay medical data is open.** I found no Malay medical Q&A and no Malay or Manglish medical speech on Hugging Face, GitHub or Kaggle [S1]. The only Malaysian medical text is a 1,146-row synthetic "Rojak" (code-switched) medical translation set on Kaggle [S61]. Machine-translated MMLU gives Malay medical exam questions for testing [S36][S37]. A Malay "Q&A Healthcare" set on the NUS data hub could not be checked; the site blocks automated access [S59]. Malay medical answers must come from our own generation and translation (**judgement**).
- **OpenMed's datasets are not NER/PII sets.** Its 26 datasets are mostly synthetic English medical reasoning (10 sets, 124,520 to 1,789,998 rows), medical-image conversations, PubMed case reports and two relation-extraction corpora [S2]–[S8]. Its NER and PII work ships as models: at least 475 NER and 516 PII model repos [S10]. Only the reasoning sets matter for us.
- **Scraped forum Q&A hides behind permissive tags.** HealthCareMagic and iCliniq forbid scraping and republishing "for commercial or any other purpose" [S20]. Their text is in OpenMed/MedDialog (tagged Apache-2.0) and, as prompts, in OpenMed's reasoning sets: I matched rows word for word [S2][S3][S5]. See [Licence red flags](#licence-red-flags).
- **Malaysian chat data is plentiful but unlicensed.** mesolitica, Scicom and malaysia-ai publish millions of Malay, Manglish and Malaysian-Mandarin rows, including spoken prompts in Malaysian voices. Almost none states a licence, and one spoken set was voiced with a CC BY-NC model [S39][S40]. Demo-only.
- **Clean Malay exists for everyday chat.** AI Singapore's SEA-Instruct-2602 has 672,674 Malay rows under ODC-BY, with a health tag [S41]. The Aya Dataset has 10,073 human-written Standard Malay rows under Apache-2.0 [S42].
- **No Malaysian medicine-package images exist.** The best real-label set is Taiwan's FDA leaflets and cartons: 44,663 documents, CC BY 4.0, Traditional Chinese [S53]. Keep the rendered-box plan in the [run sheet](../minicpm-o-finetune.md) (**judgement**).

### Top 10 picks

| Rank | Dataset | Licence → commercial? | Use | Why |
|---|---|---|---|---|
| 1 | [MedQuAD](https://github.com/abachaa/MedQuAD) (HF [`lavita/MedQuAD`](https://huggingface.co/datasets/lavita/MedQuAD)) | CC BY 4.0 → yes | Train (seed) | 16,407 consumer questions with answers from NIH websites; cleanest broad source. Rewrite answers short, then translate to ms/zh [S11]. |
| 2 | [`aisingapore/SEA-Instruct-2602`](https://huggingface.co/datasets/aisingapore/SEA-Instruct-2602), Malay config | ODC-BY → yes (attribution); gated | Train | 672,674 clean Malay instruction rows for everyday questions; a health tag lets us filter [S41]. |
| 3 | [`OpenMed/Medical-Reasoning-SFT-Mega`](https://huggingface.co/datasets/OpenMed/Medical-Reasoning-SFT-Mega) | Apache-2.0 as stated → unclear | Train; demo-only until filtered | 1.79M medical questions answered by open models; the widest "any medical question" coverage. Drop HealthCareMagic prompts to clean it [S3][S5]. |
| 4 | [`FreedomIntelligence/medical-o1-reasoning-SFT`](https://huggingface.co/datasets/FreedomIntelligence/medical-o1-reasoning-SFT) | Apache-2.0 → yes | Train | 20,171 Mandarin and 19,704 English medical questions, each with a short final answer [S23]. |
| 5 | Malaysian pack: [`mesolitica/Malaysian-SFT`](https://huggingface.co/datasets/mesolitica/Malaysian-SFT), [`Malaysian-Multiturn-Chat-Assistant`](https://huggingface.co/datasets/mesolitica/Malaysian-Multiturn-Chat-Assistant), [`Malaysian-UltraChat-Speech-Multiturn-Instructions`](https://huggingface.co/datasets/mesolitica/Malaysian-UltraChat-Speech-Multiturn-Instructions), [`Scicom-intl/Malaysian-Local-Chinese-Instruction`](https://huggingface.co/datasets/Scicom-intl/Malaysian-Local-Chinese-Instruction) | None stated → unclear | Demo only | The only Malaysian-style Malay, Manglish and Malaysian-Mandarin chat, with spoken user turns in Malaysian voices [S39][S40]. |
| 6 | [`CohereLabs/aya_dataset`](https://huggingface.co/datasets/CohereLabs/aya_dataset) | Apache-2.0 → yes | Train | 10,073 human-written Malay rows, plus 4,909 Chinese and 3,944 English. Small but native [S42]. |
| 7 | [`twinkle-ai/tw-drug-labels-vision`](https://huggingface.co/datasets/twinkle-ai/tw-drug-labels-vision) | CC BY 4.0 → yes | Train (eyes) | 21,959 real cartons and 22,704 leaflets with field labels: name, strength, dose, warnings [S53]. |
| 8 | [HealthBench](https://huggingface.co/datasets/openai/healthbench) + [K-QA](https://github.com/Itaymanes/K-QA) | MIT → yes | Test only | Health conversations graded by physician rubrics (482 emergency-referral cases), and real patient questions with physician answers [S15][S16]. |
| 9 | [`SpokenMedicalQA/SpokenMedicalQA`](https://huggingface.co/datasets/SpokenMedicalQA/SpokenMedicalQA) | Apache-2.0 → yes | Test; audio augmentation | 48 h of spoken medical questions; the only permissive set of spoken medical questions. English TTS, exam style [S45]. |
| 10 | [`CohereLabs/Global-MMLU`](https://huggingface.co/datasets/CohereLabs/Global-MMLU) (`ms`, `zh`, `en`) | Apache-2.0 → yes | Test only | The same 1,089 medical questions in Malay, Mandarin and English; shows how much knowledge is lost in Malay [S36]. |

How I ranked (**judgement**): first, does it fill a Sona gap (Malay, breadth of medical questions, spoken input, labels)? Then licence, then quality. From reasoning sets, keep only the final answer text: MiniCPM-o speaks every word it writes ([run sheet](../minicpm-o-finetune.md)).

Also worth a look:
- **LiveQA**: real consumer questions, CC BY 4.0 [S12].
- **`openmed-community/med-synth-questions-qwen3-235b-a22b-2507`**: 104,335 conversational English medical questions, CC0 [S9].
- **`gpt-omni/VoiceAssistant-400K`**: answers written for speech, Apache-2.0, made by GPT-4o [S44].
- **MultiMed**: 6.2 h of real Mandarin and 108.7 h of real English medical speech; demo-only [S46].
- **Rojak Medical Translation (Kaggle)**: 1,146 synthetic Manglish medical sentences with en/zh/ms/ta translations; a ready-made test set [S61].

## 1. OpenMed

OpenMed (https://huggingface.co/OpenMed) lists 26 datasets [S1]. None is an NER or PII set. The closest are two relation-extraction corpora (DrugProt, DDI). For Q&A or conversation, only the reasoning sets are useful.

| Dataset | What it contains | Rows | Lang | Licence (as stated) | Commercial? | Gated | Quality notes | Fit |
|---|---|---|---|---|---|---|---|---|
| [MedDialog](https://huggingface.co/datasets/OpenMed/MedDialog) | Patient message → doctor reply, from `ruslanmv/ai-medical-chatbot` [S2] | 251,731 (226,557 train, 25,174 val) | en | Apache-2.0, "inherited" | no: HealthCareMagic/iCliniq text, whose terms forbid reuse [S5][S20] | no | Raw forum replies with typos. About 5,000 of 25,174 validation replies contain a "Dr. Name" pattern (my regex). The card's example is not in the data [S2] | low: licence |
| [Medical-Reasoning-SFT-Mega](https://huggingface.co/datasets/OpenMed/Medical-Reasoning-SFT-Mega) | Deduplicated merge of 7 single-model sets (GPT-OSS-120B-V2, Qwen3-Next, Nemotron, GLM, MiniMax, Trinity, Baichuan); system/user/assistant with reasoning [S3] | 1,789,998 (~3.78B tokens) | en | Apache-2.0 | unclear: some prompts are verbatim HealthCareMagic questions [S5] | no | Prompts mix MCQs, PubMedQA yes/no items, guideline summaries and forum questions. Answers are long markdown | high, after filtering |
| […-GPT-OSS-120B](https://huggingface.co/datasets/OpenMed/Medical-Reasoning-SFT-GPT-OSS-120B) | gpt-oss-120b (high effort) answers; seeded from II-Medical-Reasoning-SFT [S3][S4] | 200,193 | en | Apache-2.0 | unclear: seed has no licence and includes ChatDoctor prompts | no | Not in Mega (Mega uses V2) | low: use Mega |
| […-GPT-OSS-120B-Small](https://huggingface.co/datasets/OpenMed/Medical-Reasoning-SFT-GPT-OSS-120B-Small) | Subset of the row above | 131,728 | en | Apache-2.0 | unclear | no | Not in Mega | low |
| […-GPT-OSS-120B-V2](https://huggingface.co/datasets/OpenMed/Medical-Reasoning-SFT-GPT-OSS-120B-V2) | gpt-oss-120b; prompt source not stated | 506,150 | en | Apache-2.0 | unclear | no | In Mega | medium: use Mega |
| […-Qwen3-Next-80B](https://huggingface.co/datasets/OpenMed/Medical-Reasoning-SFT-Qwen3-Next-80B) | Qwen3-Next-80B answers | 604,249 | en | Apache-2.0 | unclear | no | In Mega | medium: use Mega |
| […-Nemotron-Nano-30B](https://huggingface.co/datasets/OpenMed/Medical-Reasoning-SFT-Nemotron-Nano-30B) | Nemotron Nano 30B answers | 444,544 | en | Apache-2.0 | unclear | no | In Mega | medium: use Mega |
| […-GLM_4.5_Air](https://huggingface.co/datasets/OpenMed/Medical-Reasoning-SFT-GLM_4.5_Air) | GLM-4.5-Air answers | 225,179 | en | Apache-2.0 | unclear | no | In Mega | medium: use Mega |
| […-MiniMax-M2.1](https://huggingface.co/datasets/OpenMed/Medical-Reasoning-SFT-MiniMax-M2.1) | MiniMax-M2.1 answers | 204,773 | en | Apache-2.0 | unclear | no | In Mega | medium: use Mega |
| […-Trinity-Mini](https://huggingface.co/datasets/OpenMed/Medical-Reasoning-SFT-Trinity-Mini) | Trinity-Mini answers | 810,284 | en | Apache-2.0 | unclear | no | In Mega | medium: use Mega |
| […-Baichuan-M3-235B](https://huggingface.co/datasets/OpenMed/Medical-Reasoning-SFT-Baichuan-M3-235B) | Answers from Baichuan-M3-235B, a medical model | 124,520 | en | Apache-2.0 | unclear | no | In Mega | medium: use Mega |
| [multicare-images](https://huggingface.co/datasets/OpenMed/multicare-images) | Figures, captions and labels from PubMed Central open-access case reports [S6] | 161,702 | en | CC BY 4.0 | yes: check each row's article licence | no | Radiology, pathology, endoscopy, photos | low: not patient questions |
| [multicare-case-images](https://huggingface.co/datasets/OpenMed/multicare-case-images) | One image per figure, with the case text that cites it | 96,730 | en | CC BY 4.0 | yes (per row) | no | — | low |
| [multicare-cases](https://huggingface.co/datasets/OpenMed/multicare-cases) | Case narratives with age and gender | 85,653 | en | CC BY 4.0 | yes (per row) | no | Clinician-written | low |
| [multicare-articles](https://huggingface.co/datasets/OpenMed/multicare-articles) | Article metadata and abstracts | 85,653 | en | CC BY 4.0 | yes (per row) | no | — | low |
| [synthvision-seeds](https://huggingface.co/datasets/OpenMed/synthvision-seeds) | Images from ROCO, MultiCaRe, PathVQA and VQA-RAD [S7] | 119,137 | en | Apache-2.0 | yes as stated; source licences vary | no | — | low: medical imaging |
| [synthvision-annotated-qwen](https://huggingface.co/datasets/OpenMed/synthvision-annotated-qwen) | Qwen3.5-397B multi-turn conversations and reports about each image | 59,476 | en | Apache-2.0 | yes as stated | no | Synthetic | low |
| [synthvision-annotated-kimi](https://huggingface.co/datasets/OpenMed/synthvision-annotated-kimi) | The same, written by Kimi K2.5 | 59,539 | en | Apache-2.0 | yes as stated | no | Synthetic | low |
| [synthvision-validated-qwen-by-kimi](https://huggingface.co/datasets/OpenMed/synthvision-validated-qwen-by-kimi) | Qwen annotations that Kimi judged consistent | card 55,359; viewer 114,835 | en | Apache-2.0 | yes as stated | no | Card and viewer counts disagree | low |
| [synthvision-validated-kimi-by-qwen](https://huggingface.co/datasets/OpenMed/synthvision-validated-kimi-by-qwen) | Kimi annotations that Qwen judged consistent | card 55,382; viewer 114,921 | en | Apache-2.0 | yes as stated | no | As above | low |
| [afrimedqa_v2](https://huggingface.co/datasets/OpenMed/afrimedqa_v2) | Mirror of AfriMed-QA v2: MCQs, short answers, consumer queries [S8] | 15,275 | en | none on the mirror | no: upstream LICENSE is CC BY-NC-SA 4.0 [S22] | no (upstream is gated) | African context | low |
| [DDI-Corpus-Processed](https://huggingface.co/datasets/OpenMed/DDI-Corpus-Processed) | Drug–drug interaction sentence classes (SemEval-2013) | 7,142 | en | CC BY-NC 4.0 | no | no | Expert annotation | low |
| [drugprot-parquet](https://huggingface.co/datasets/OpenMed/drugprot-parquet) | DrugProt: PubMed abstracts with chemical–protein relations | 4,250 | en | CC BY 4.0 | yes | no | Expert annotation | low: extraction task |
| [PubHealth-Processed](https://huggingface.co/datasets/OpenMed/PubHealth-Processed) | Public-health claim fact-checking, including political claims | 12,253 | en | none (no card; upstream repo MIT) | unclear | no | — | low |
| [agab-db](https://huggingface.co/datasets/OpenMed/agab-db) | Antibody–antigen binding records | 981,665 (card: 1,227,083) | en | "other" | unclear | no | — | not relevant |
| [openmed-traces](https://huggingface.co/datasets/OpenMed/openmed-traces) | Audit traces from the OpenMed agent | 7 | en | none | unclear | no | Not training data | not relevant |

The seven generator models carry Apache-2.0, MIT, modified MIT, OpenMDW or NVIDIA open-model licences on their cards [S60]. So the answers are probably usable; the problem is the prompts (**judgement**).

A separate community org, [`openmed-community`](https://huggingface.co/openmed-community), has 6 more datasets [S9]:
- `med-synth-questions-qwen3-235b-a22b-2507`: 104,335 English medical questions, no answers, conversational ("Hey, can you walk me through…"). CC0. Qwen3-235B wrote them from proprietary physician documents, which are not included. **Medium: clean prompts.**
- `synthetic-neurology-conversations` (1,452 rows, CC0), `MedReason-Stenographic` (31,535, Apache-2.0, symbolic reasoning), `TheBlueScrubs-v1-fixed` (11,080,331 medical web texts, Apache-2.0, pretraining only), `med-synth-questions-gemma-3-27b-it` (GPL-3.0) and `mmlu-5-options-rl-ready` (MIT). All low fit.

## 2. Medical Q&A and doctor–patient dialogue (text)

### 2a. English

| Dataset | Lang | Size | Licence (as stated) | Commercial? | Gated | Contains | Quality notes | Fit |
|---|---|---|---|---|---|---|---|---|
| MedQuAD: [GitHub](https://github.com/abachaa/MedQuAD), HF [`lavita/MedQuAD`](https://huggingface.co/datasets/lavita/MedQuAD), [`keivalya/MedQuad-MedicalQnADataset`](https://huggingface.co/datasets/keivalya/MedQuad-MedicalQnADataset) | en | 47,441 questions; 16,407 with answers | CC BY 4.0 (GitHub LICENSE); HF mirrors state none | yes | no | Questions and answers from 12 NIH websites. Answers were removed from 31,034 rows (A.D.A.M., MedlinePlus drugs and herbs, GARD) for copyright [S11] | Authoritative but long, web-page style; US-centric | **high** |
| LiveQA Medical (TREC 2017): [GitHub](https://github.com/abachaa/LiveQA_MedicalTask_TREC2017), HF [`truehealth/liveqa`](https://huggingface.co/datasets/truehealth/liveqa) | en | 635 rows (HF) | CC BY 4.0 (README); HF none | yes | no | Real consumer questions sent to the US National Library of Medicine, with reference answers [S12] | Messy real questions; small | medium: test and seed |
| MedicationQA: [GitHub](https://github.com/abachaa/Medication_QA_MedInfo2019), HF [`truehealth/medicationqa`](https://huggingface.co/datasets/truehealth/medicationqa) | en | 690 | CC BY 4.0 (README); HF none | unclear: answers quote MedlinePlus drug pages | no | Consumer medication questions. Answer sources in the first 100 rows: DailyMed 43, MedlinePlus 17, Mayo Clinic 3, others [S13] | Real questions; answers are verbatim excerpts | medium: test |
| [`katielink/healthsearchqa`](https://huggingface.co/datasets/katielink/healthsearchqa) | en | 3,173 (+140-question subset) | HF "unknown"; released as a supplementary file of a CC BY 4.0 Nature paper [S14] | unclear (likely CC BY, **judgement**) | no | Commonly searched consumer questions, no answers | Real search phrasing | medium: prompts and test |
| [K-QA](https://github.com/Itaymanes/K-QA) (GitHub only) | en | 1,212 questions; 201 with physician answers (1,589 statements) | MIT | yes | n/a | Real questions that patients wrote on an online platform; scores for hallucination and completeness [S15] | Expert answers; small | **high: test** |
| [`openai/healthbench`](https://huggingface.co/datasets/openai/healthbench) | mostly en; 53 conversations contain Chinese; I found no Malay | 5,000 conversations, plus hard, consensus and meta-eval files | MIT | yes | no | Multi-turn conversations with a user or a health professional, graded by 48,562 rubric criteria written by 262 physicians. Themes include global health (1,097), hedging (1,071) and emergency referrals (482) [S16] | Has a canary string: never train on it | **high: test** |
| [`Intelligent-Internet/II-Medical-Reasoning-SFT`](https://huggingface.co/datasets/Intelligent-Internet/II-Medical-Reasoning-SFT) | en (+ some zh sources) | 2,197,741 | none | unclear | no | Mix of R1 traces, Qwen3-235B answers to MedMCQA, MedQA, PubMedQA and MedReason, ApolloCorpus prompts, and 215,647 ChatDoctor prompts [S4] | Long reasoning | medium: demo |
| [`FreedomIntelligence/medical-o1-reasoning-SFT`](https://huggingface.co/datasets/FreedomIntelligence/medical-o1-reasoning-SFT) | en, zh | 90,120: en 19,704; en_mix 24,887; zh 20,171; zh_mix 25,358 | Apache-2.0 | yes | no | Verifiable exam problems; GPT-4o reasoning plus a short final `Response` [S23] | Exam style; GPT-4o made | **high (zh), medium (en)** |
| [`FreedomIntelligence/medical-o1-verifiable-problem`](https://huggingface.co/datasets/FreedomIntelligence/medical-o1-verifiable-problem) | en | 40,644 | Apache-2.0 | yes | no | Open-ended exam problems with ground-truth answers | Good for RL or testing | medium |
| [`FreedomIntelligence/Medical-R1-Distill-Data`](https://huggingface.co/datasets/FreedomIntelligence/Medical-R1-Distill-Data) | en | 22,000 | Apache-2.0 | yes | no | DeepSeek-R1 reasoning on verifiable problems [S24] | Very long reasoning | low |
| [`UCSC-VLAA/MedReason`](https://huggingface.co/datasets/UCSC-VLAA/MedReason) | en | 32,682 | Apache-2.0 | yes | no | Step-by-step explanations guided by a knowledge graph, for questions from 7 medical QA sets [S25] | Exam style | low |
| [`TsinghuaC3I/UltraMedical`](https://huggingface.co/datasets/TsinghuaC3I/UltraMedical) | en | 409,593 | MIT | unclear: includes ChatDoctor and MedInstruct-52k prompts | no | GPT-4 answers to MedQA, MedMCQA, PubMedQA, ChatDoctor, MedQuAD and synthetic questions [S26] | GPT-4 made | medium: demo |
| [`lavita/AlpaCare-MedInstruct-52k`](https://huggingface.co/datasets/lavita/AlpaCare-MedInstruct-52k) | en | 52,002 | HF none; GitHub data licence CC BY-NC 4.0 [S27] | no | no | GPT-4-generated medical instructions | Synthetic | low |
| [`BI55/MedText`](https://huggingface.co/datasets/BI55/MedText) | en | 1,412 | CC BY 4.0 | yes | no | Patient presentations with diagnosis and treatment, converted with GPT-4. Includes "I cannot replace a doctor" items [S28] | Three doctors rated 10 samples "textbook quality" | medium |
| medalpaca meadow: [`wikidoc_patient_information`](https://huggingface.co/datasets/medalpaca/medical_meadow_wikidoc_patient_information), [`wikidoc`](https://huggingface.co/datasets/medalpaca/medical_meadow_wikidoc), [`medical_flashcards`](https://huggingface.co/datasets/medalpaca/medical_meadow_medical_flashcards), [`health_advice`](https://huggingface.co/datasets/medalpaca/medical_meadow_health_advice), [`mediqa`](https://huggingface.co/datasets/medalpaca/medical_meadow_mediqa) | en | 5,942; 10,000; 33,955; 8,676; 2,208 | "cc" (version not stated); the WikiDoc site is CC BY-SA 3.0 [S21] | WikiDoc sets: yes (SA) (**judgement**); others unclear | no | WikiDoc patient pages (headings are the questions); textbook and Anki flashcards rephrased by GPT-3.5; `health_advice` is a causal-language classification set, not advice | Mixed | medium (patient information); others low |
| [`lavita/ChatDoctor-HealthCareMagic-100k`](https://huggingface.co/datasets/lavita/ChatDoctor-HealthCareMagic-100k), [`…-iCliniq`](https://huggingface.co/datasets/lavita/ChatDoctor-iCliniq) | en | 112,165; 7,321 | none on HF; ChatDoctor repo is Apache-2.0 for code [S5] | no: site terms | no | Real forum questions and doctor replies | Short, low-quality replies | low |
| [`ruslanmv/ai-medical-chatbot`](https://huggingface.co/datasets/ruslanmv/ai-medical-chatbot) | en | 256,916 | none on HF; repo Apache-2.0 | no: site terms | no | The same two sites [S5] | As above | low |
| MedDialog-EN: [`UCSD26/medical_dialog`](https://huggingface.co/datasets/UCSD26/medical_dialog) | en | ~0.26M dialogues (card) | "unknown"; the card says copyright belongs to the sites [S20] | no | no | iCliniq and HealthCareMagic conversations | As above | low |
| [`qiaojin/PubMedQA`](https://huggingface.co/datasets/qiaojin/PubMedQA) | en | 1,000 labelled; 61,249 unlabelled; 211,269 generated | MIT | yes | no | Yes/no/maybe questions about research abstracts [S17] | Not patient-facing | low |
| [`openlifescienceai/medmcqa`](https://huggingface.co/datasets/openlifescienceai/medmcqa) | en | 193,155 | Apache-2.0 (HF); MIT (GitHub) | yes | no | Indian entrance-exam MCQs with explanations [S18] | Exam style | low |
| MedQA: [`GBaker/MedQA-USMLE-4-options`](https://huggingface.co/datasets/GBaker/MedQA-USMLE-4-options), [`bigbio/med_qa`](https://huggingface.co/datasets/bigbio/med_qa) | en; zh and zh-TW in bigbio | 11,451 (4 options) | CC BY 4.0 (GBaker); "unknown" (bigbio); source repo MIT [S19] | yes | no | USMLE-style and Chinese licensing-exam MCQs | Exam style | low |
| [`intronhealth/afrimedqa_v2`](https://huggingface.co/datasets/intronhealth/afrimedqa_v2) | en | 15,275 | CC BY-SA 4.0 (card) vs CC BY-NC-SA 4.0 (GitHub LICENSE) [S22] | no | yes (click-through) | African MCQs, short answers, consumer queries | African context | low |

### 2b. Chinese

**Judgement** for all rows: these are Mainland China data. Drug brands, health-system advice and Traditional Chinese Medicine content differ from Malaysia, so every Mandarin answer needs a Malaysian review.

| Dataset | Size | Licence (as stated) | Commercial? | Gated | Contains | Quality notes | Fit |
|---|---|---|---|---|---|---|---|
| `medical-o1-reasoning-SFT` zh (see 2a) and [`Medical-R1-Distill-Data-Chinese`](https://huggingface.co/datasets/FreedomIntelligence/Medical-R1-Distill-Data-Chinese) | 20,171 (+25,358 mix); 17,000 | Apache-2.0 | yes | no | Exam questions with GPT-4o or DeepSeek-R1 reasoning and a short answer [S23][S24] | Exam style | **high (o1 zh)**; R1 low |
| [`FreedomIntelligence/HuatuoGPT2-SFT-GPT4-140K`](https://huggingface.co/datasets/FreedomIntelligence/HuatuoGPT2-SFT-GPT4-140K) | 142,248 (card) | Apache-2.0 | unclear: questions come from v1 below | no | GPT-4 answers to HuatuoGPT questions [S29] | GPT-4 made | medium: demo |
| [`FreedomIntelligence/HuatuoGPT-sft-data-v1`](https://huggingface.co/datasets/FreedomIntelligence/HuatuoGPT-sft-data-v1) | 226,042 | Apache-2.0 | unclear: 69,768 "real-world instructions from doctors" and 25,986 real conversations, source not stated | no | ChatGPT-distilled instructions and conversations, plus real doctor data [S29] | Mixed | medium: demo |
| [`FreedomIntelligence/Huatuo26M-Lite`](https://huggingface.co/datasets/FreedomIntelligence/Huatuo26M-Lite) | 177,703 | Apache-2.0 | unclear: questions collected from the internet | no | Frequent web questions with answers rewritten by ChatGPT | Consumer style | medium: demo |
| [`FreedomIntelligence/huatuo_encyclopedia_qa`](https://huggingface.co/datasets/FreedomIntelligence/huatuo_encyclopedia_qa) | 364,420 | Apache-2.0 | unclear: sources are zh.wikipedia (CC BY-SA) and 51zyzy.com | no | Encyclopedia QA | Encyclopedic | low |
| [`FreedomIntelligence/huatuo_knowledge_graph_qa`](https://huggingface.co/datasets/FreedomIntelligence/huatuo_knowledge_graph_qa) | 798,444 | Apache-2.0 | yes as stated | no | Templated QA from medical knowledge graphs | Templated | low |
| [`FreedomIntelligence/huatuo_consultation_qa`](https://huggingface.co/datasets/FreedomIntelligence/huatuo_consultation_qa) | 32,708,346 | Apache-2.0 | unclear: crawled consultation site | no | Questions only; answers are URLs | Not usable as is | low |
| [`Suprit/CMtMedQA`](https://huggingface.co/datasets/Suprit/CMtMedQA) | 68,023 | MIT | unclear: "real doctor–patient conversations", source not stated [S31] | no | Multi-turn consultations in which the doctor asks follow-up questions | Real dialogue style | medium: demo |
| cMedQA2: [GitHub](https://github.com/zhangsheng93/cMedQA2), HF [`fzkuji/cMedQA2`](https://huggingface.co/datasets/fzkuji/cMedQA2) | 108,000 questions; 203,569 answers | GPL-3.0 LICENSE, but the README says "non-commercial research" [S30] | no | no | Community Q&A | Real, noisy | low |
| MedDialog-CN ([`UCSD26/medical_dialog`](https://huggingface.co/datasets/UCSD26/medical_dialog) `zh`) | 1.1M dialogues (card) | "unknown"; copyright belongs to haodf.com [S20] | no | no | Consultations crawled from haodf.com | Real, noisy | low |
| [`michaelwzhu/ChatMed_Consult_Dataset`](https://huggingface.co/datasets/michaelwzhu/ChatMed_Consult_Dataset) | 549,326 (viewer); card says 110,113 | CC BY 4.0 (card) vs README disclaimer (in Chinese): academic research only, commercial use strictly prohibited [S32] | no | no | Crawled consultation questions with GPT-3.5 answers | Synthetic answers | low |
| [`Flmc/DISC-Med-SFT`](https://huggingface.co/datasets/Flmc/DISC-Med-SFT) | 464,898 | Apache-2.0 | unclear: rebuilt from MedDialog, cMedQA2 and others [S33] | no | ChatGPT-rewritten consultations, knowledge-graph QA, general chat | Mixed | medium: demo |
| [`shibing624/medical`](https://huggingface.co/datasets/shibing624/medical) | ~2.4M (card files) | Apache-2.0 | unclear: includes HealthCareMagic-100k, crawled consultations and textbook text [S34] | no | Pretraining, SFT and reward files | Mixed | low |
| [`Mxode/Chinese-Medical-Instruct-1M`](https://huggingface.co/datasets/Mxode/Chinese-Medical-Instruct-1M) | 998,387 | CC BY-SA 4.0 | unclear: prompts come from `shibing624/medical` | no | Regenerated answers | Synthetic | low |
| [`FreedomIntelligence/CMB`](https://huggingface.co/datasets/FreedomIntelligence/CMB), [`fzkuji/CMExam`](https://huggingface.co/datasets/fzkuji/CMExam) | CMB: 11,200 test MCQs + 74 clinical cases; CMExam: 68,119 | Apache-2.0 | yes | no | Chinese medical exam benchmarks [S35] | Exam style | low: test only |
| [`tyang816/MedChatZH`](https://huggingface.co/datasets/tyang816/MedChatZH) | 764,129 | Apache-2.0 | yes as stated | no | Traditional Chinese Medicine books and dialogue instructions | TCM focus | low |

### 2c. Malay or Malaysian

No open Malay medical Q&A or dialogue set exists that I could find. These searches came back empty: Hugging Face (malay/malaysian medical, malay health, kesihatan, perubatan, medqa malay, malaysia hospital/clinic, malay doctor), GitHub repository search and Kaggle [S1]. What exists:

| Dataset | Lang | Size | Licence (as stated) | Commercial? | Gated | Contains | Quality notes | Fit |
|---|---|---|---|---|---|---|---|---|
| [Rojak Medical Translation Dataset (Malaysia)](https://www.kaggle.com/datasets/wongjiarong/rojak-medical-translation-dataset-malaysia) (Kaggle) | Manglish/Rojak, en, zh, ms, ta | 1,146 (1,046 train, 100 eval) | CC BY-SA 4.0 (Kaggle field); the description suggests CC BY 4.0 or CC0 [S61] | yes (SA) | no | Synthetic code-switched medical sentences with 4 parallel translations and a slang glossary; a 2026 final-year project | Synthetic; generator not stated; tiny | **medium: test** |
| [`CohereLabs/Global-MMLU`](https://huggingface.co/datasets/CohereLabs/Global-MMLU) `ms` | ms (+41 languages) | 14,042 test; 1,089 in the six medical subjects | Apache-2.0 | yes | no | MMLU, machine-translated with professional and community post-edits; Malay is rated a "Mid" resource [S36] | Exam MCQ | **medium: test** |
| [`mesolitica/translated-MMLU`](https://huggingface.co/datasets/mesolitica/translated-MMLU) | ms | 14,042 | none | unclear | no | MMLU through Google Translate; the card warns translated answers can be incoherent [S37] | Machine translation | low |
| [`UMxYTLAILabs/MalayMMLU`](https://huggingface.co/datasets/UMxYTLAILabs/MalayMMLU) | ms | 24,213 | HF none; GitHub BSD-3-Clause | yes (BSD) | no | Malaysian school curriculum questions; not medical [S37] | Native Malay | low: general Malay test |
| [`mesolitica/Speech-Instructions-MalayMMLU`](https://huggingface.co/datasets/mesolitica/Speech-Instructions-MalayMMLU) | ms (audio) | 10K–100K (size tag) | none | unclear | no | MalayMMLU read by Malaysian-Dia voices; the card says not to train on it [S37] | Synthetic speech | low: spoken Malay test |
| NUS IDS NZSG NLP data hub, "Q&A Healthcare" | ms | not checked | not checked | unclear | — | Q&A pairs from Malay healthcare documents, per a search snippet [S59] | Site blocks automated access | unknown |
| [`IndoHealth-NLP/NCD_Instruct-Tuning_Medical_QA_Indonesian`](https://huggingface.co/datasets/IndoHealth-NLP/NCD_Instruct-Tuning_Medical_QA_Indonesian) | id, en | <1K | CC BY-NC 4.0 | no | no | Indonesian chronic-disease QA. Indonesian is close to Malay but not the same | Tiny | low |

`openai/MMMLU` (MIT) has professional Chinese and Indonesian translations, but no Malay [S37].

### 2d. Multilingual

| Dataset | Lang | Size | Licence (as stated) | Commercial? | Gated | Contains | Quality notes | Fit |
|---|---|---|---|---|---|---|---|---|
| [`Henrychur/MMedBench`](https://huggingface.co/datasets/Henrychur/MMedBench) | en, zh, ja, fr, ru, es | 45,048 train + 8,518 test | CC BY-NC 4.0 | no | no | Exam MCQs with rationales [S38] | Some rationales human-checked (a flag per row) | low: exam style, NC |
| [`HiTZ/MedExpQA`](https://huggingface.co/datasets/HiTZ/MedExpQA) | en, es, fr, it | 1K–10K | CC BY 4.0 | yes | no | Spanish residency-exam MCQs with doctors' explanations | Doctor-written explanations | low: no ms/zh |
| [`FreedomIntelligence/ApolloCorpus`](https://huggingface.co/datasets/FreedomIntelligence/ApolloCorpus) | en, zh, fr, es, ar, hi | 3,741,196 (pretrain config) | Apache-2.0 | yes as stated; mixed web sources, not audited | no | Textbook, guideline and patient QA corpora | Mixed sources | low |
| [`FreedomIntelligence/ApolloMoEDataset`](https://huggingface.co/datasets/FreedomIntelligence/ApolloMoEDataset) | 50 languages, no Malay | 100K–1M | MIT | yes | no | Multilingual medical corpus | — | low: no Malay |
| [`NLP-FBK/multilingual-medical-reasoning-traces`](https://huggingface.co/datasets/NLP-FBK/multilingual-medical-reasoning-traces) | en, es, it | 178,618 / 178,355 / 175,725 | none | unclear | no | Reasoning traces | Long reasoning | low |

## 3. Malay, Manglish and Malaysian-Mandarin instruction and chat

| Dataset | Lang | Size | Licence (as stated) | Commercial? | Gated | Contains | Quality notes | Fit |
|---|---|---|---|---|---|---|---|---|
| [`aisingapore/SEA-Instruct-2602`](https://huggingface.co/datasets/aisingapore/SEA-Instruct-2602) | ms (+6 SEA languages) | Malay 672,674 (7.2M in all) | ODC-BY | yes (attribution) | yes (click-through) | Open-source prompts (Infinity-Instruct, AceReason, Sailor2, WangchanX-FLAN, Tulu 3, SmolTalk, WildChat…) with synthetic responses and tags for domain, task and translation [S41] | In the 4,000-row Malay sample: 3,508 prompts translated from English; 74 tagged `Physical_and_Sexual_Health`. Response model not stated in what I could read | **high** |
| [`aisingapore/Small-SEA-Instruct-2602`](https://huggingface.co/datasets/aisingapore/Small-SEA-Instruct-2602) | ms (+6) | 28,000 (4,000 Malay) | ODC-BY | yes (attribution) | no | High-quality sample of the row above | Not gated: inspect before accepting terms | medium |
| [`CohereLabs/aya_dataset`](https://huggingface.co/datasets/CohereLabs/aya_dataset) | 65 languages | Standard Malay 10,073 (6,179 original, 3,894 re-annotations); Chinese 3,038 simplified + 1,871 traditional; English 3,944 | Apache-2.0 | yes | no | Human-written prompts and answers [S42] | Native; about 169 Malay rows contain health words (my keyword count) | **medium** |
| [`CohereLabs/aya_collection_language_split`](https://huggingface.co/datasets/CohereLabs/aya_collection_language_split) `standard_malay` | ms | 4,144,165 | Apache-2.0 | yes | no | Public datasets turned into Malay with templates or translated by NLLB-3.3B [S42] | Machine translation | low |
| [`mesolitica/Malaysian-SFT`](https://huggingface.co/datasets/mesolitica/Malaysian-SFT) | ms, en, Manglish, zh, ta, Jawi | 4,536,469 | none | unclear | no | Synthetic Malaysian QA (GPT-4, Llama-3-70B, Mixtral), Malaysian UltraChat, dialects, Manglish QA, safe replies, "force language" sets including Mandarin [S39] | Synthetic, partly from closed models | **high: demo** |
| [`mesolitica/Malaysian-Ultrachat`](https://huggingface.co/datasets/mesolitica/Malaysian-Ultrachat) | ms, en | 233,308 rows in 11 files (largest: Hansard 72,538; Astro Awani 60,198; textbooks 49,842) | none | unclear: grounded on copyrighted news | no | Multi-turn chats grounded on Malaysian news, Hansard, laws, government PDFs, religious sites and Wikipedia | Formal topics | medium: demo |
| [`mesolitica/Malaysian-Instructions`](https://huggingface.co/datasets/mesolitica/Malaysian-Instructions) | ms, en | 958,667 | none | unclear | no | Generated by Malaysian-Qwen2.5-72B-Instruct (no licence) | Synthetic | medium: demo |
| [`mesolitica/Malaysian-Multiturn-Chat-Assistant`](https://huggingface.co/datasets/mesolitica/Malaysian-Multiturn-Chat-Assistant) | ms, en | 221,348 | none | unclear | no | Multi-turn chats with complex system prompts; at least 2 user turns voiced by Malaysian-Dia-1.6B and checked by forced alignment | Matches MiniCPM-o's audio-in training | **high: demo** |
| [`mesolitica/Malaysian-UltraChat-Speech-Multiturn-Instructions`](https://huggingface.co/datasets/mesolitica/Malaysian-UltraChat-Speech-Multiturn-Instructions) | ms, en | 192,821 | none | unclear | no | UltraChat user turns voiced by Malaysian-Dia-1.6B. Voice prompts include Dewan Rakyat livestream clips | Formal topics | medium: demo |
| [`mesolitica/Malaysian-Speech-Instructions`](https://huggingface.co/datasets/mesolitica/Malaysian-Speech-Instructions) | ms, en, zh | 578,553 | none | no: voiced with Malaysian-F5-TTS-v2, which is CC BY-NC 4.0 | no | Short spoken prompts, including a "force Mandarin" set | Synthetic speech | medium: demo |
| [`mesolitica/MaLLaM-2.5-Small-Manglish-QA`](https://huggingface.co/datasets/mesolitica/MaLLaM-2.5-Small-Manglish-QA) | en, ms, Manglish | ≥174,255 (politics 66,025; science 59,762; math 48,468) | none | unclear | no | Parallel English, Malay and Manglish versions of each turn | Exaggerated slang ("Sibeh jialat sia") | low: input side only |
| [`Scicom-intl/Malaysian-Local-Chinese-Instruction`](https://huggingface.co/datasets/Scicom-intl/Malaysian-Local-Chinese-Instruction) | zh (Malaysian) | 1,945 | none | unclear | no | Malaysian Mandarin with Malay and English loanwords, written by Qwen3-235B [S40] | Natural local register; tiny | **high: demo** |
| [`Scicom-intl/Malaysian-Instructions`](https://huggingface.co/datasets/Scicom-intl/Malaysian-Instructions) | ms | 222,038 | none | unclear | no | Reasoning (93,098), MCQs (121,371), coding, Tamil | Synthetic | medium: demo |
| [`Scicom-intl/Malaysian-Guardrail-QA`](https://huggingface.co/datasets/Scicom-intl/Malaysian-Guardrail-QA) | ms, en | 4,000 | none | unclear | no | Malaysian-style refusals | Synthetic | medium: demo |
| [`emhaihsan/Synth-Manglish`](https://huggingface.co/datasets/emhaihsan/Synth-Manglish) | Manglish | 2,457 clips | CC BY 4.0 | unclear: Gemini text, ElevenLabs reference voices [S43] | no | Everyday Manglish sentences voiced by a Scicom TTS | Not medical | low |

Everyday chat in English and Mandarin, for balance [S44]:
- **[`HuggingFaceTB/smoltalk`](https://huggingface.co/datasets/HuggingFaceTB/smoltalk)**: 1,098,865 rows in the `all` config, English. New subsets are Apache-2.0; others keep their source licences. Includes `everyday-conversations` (2,379 rows).
- **[`gpt-omni/VoiceAssistant-400K`](https://huggingface.co/datasets/gpt-omni/VoiceAssistant-400K)**: 470,054 rows, English, Apache-2.0, ~219 GB. GPT-4o wrote the answers for speech, without code or symbols. Good for "speakable" answers.
- **[`BAAI/Infinity-Instruct`](https://huggingface.co/datasets/BAAI/Infinity-Instruct)** (en/zh, CC BY-SA 4.0, gated) and **[`m-a-p/COIG-CQIA`](https://huggingface.co/datasets/m-a-p/COIG-CQIA)** (44,694 zh rows; licence not stated).

## 4. Spoken medical questions and medical speech

No Malay or Manglish medical speech exists in the open, as far as I found. The only Mandarin medical speech is MultiMed's 6.2 h [S1][S46].

| Dataset | Lang | Size | Licence (as stated) | Commercial? | Gated | Contains | Quality notes | Fit |
|---|---|---|---|---|---|---|---|---|
| [`SpokenMedicalQA/SpokenMedicalQA`](https://huggingface.co/datasets/SpokenMedicalQA/SpokenMedicalQA) | en | 48 h synthetic; 8 tasks (MedMCQA, MedQA, 6 MMLU medical subjects) | Apache-2.0 (card YAML only) | yes | no | Spoken versions of medical exam questions; paper Labrak et al. 2024 [S45] | TTS; exam style; empty card | **medium** |
| [`leduckhai/MultiMed`](https://huggingface.co/datasets/leduckhai/MultiMed) | en 108.7 h; vi 15.8 h; de 10.7 h; fr 6.8 h; zh 6.2 h | ~150 h | MIT (HF tag) | unclear: YouTube audio used under US fair use for "non-commercial scientific purpose" [S46] | no | Real medical talks, consultations and podcasts; 10 recording conditions, 6 speaker roles; human transcripts | Real accents and drug names | medium: demo |
| [`leduckhai/MultiMed-ST`](https://huggingface.co/datasets/leduckhai/MultiMed-ST) | as above | as above | MIT | unclear | no | The same audio with translations | — | low |
| [`aline-gassenn/MedDialog-Audio`](https://huggingface.co/datasets/aline-gassenn/MedDialog-Audio) | en | 147,476 files (10,534 dialogues) | CC BY-NC 4.0 | no: also built on scraped MedDialog-EN | no | TTS of MedDialog-EN, clean and with white or hospital noise [S47] | Synthetic voices; patient-style questions | medium: demo |
| Medical Speech, Transcription, and Intent: [Kaggle](https://www.kaggle.com/datasets/paultimothymooney/medical-speech-transcription-and-intent), HF mirrors such as [`Hani89/medical_asr_recording_dataset`](https://huggingface.co/datasets/Hani89/medical_asr_recording_dataset) | en | 8.5 h; 6,661 utterances | Kaggle "Other (specified in description)", but none is given; mirrors say Apache-2.0, "other" or nothing [S48] | unclear | no | Crowd workers describing symptoms ("I need help with my migraines") | Some wrong labels and poor audio, per the card | medium: demo |
| [`ekacare/eka-medical-asr-evaluation-dataset`](https://huggingface.co/datasets/ekacare/eka-medical-asr-evaluation-dataset) | en, hi | 3,619 en + 320 hi clips | MIT | yes | no | Medical terms, read sentences and unscripted conversations, recorded mostly by the company's own team in India [S49] | Test set | low-medium: drug-name test |
| [`intronhealth/afrispeech-200`](https://huggingface.co/datasets/intronhealth/afrispeech-200) | en | 200 h (41,765 clinical clips) | CC BY-NC-SA 4.0 | no | no | Read African-accented clinical and general English [S50] | Read speech | low |
| [`intronhealth/afrispeech-dialog`](https://huggingface.co/datasets/intronhealth/afrispeech-dialog) | en | 6 h (20 medical, 29 general conversations) | CC BY-NC-SA 4.0 | no | no | Recorded conversations with African accents [S50] | — | low |
| [`united-we-care/United-Syn-Med`](https://huggingface.co/datasets/united-we-care/United-Syn-Med) | en | 100K–1M (size tag) | CC BY-SA 4.0 | yes (SA) | yes (click-through) | Synthetic medical ASR speech [S51] | Card not readable without accepting terms | low-medium |
| [`Hani89/Synthetic-Medical-Speech-Dataset`](https://huggingface.co/datasets/Hani89/Synthetic-Medical-Speech-Dataset) | en | 10K–100K (size tag) | Apache-2.0 | yes | no | TTS of medical text [S51] | Synthetic | low |
| HumynLabs [`medical-symptoms-english-audio`](https://huggingface.co/datasets/HumynLabs/medical-symptoms-english-audio) (+ prescription, opinion sets) | en | <1K each | CC BY 4.0 | yes | no | One fixed script read by many Indian speakers [S51] | "B-grade" on purpose | low |
| [`hlt-lab/voicebench`](https://huggingface.co/datasets/hlt-lab/voicebench) | en | e.g. sd-qa 6,083; mmsu 3,074; alpacaeval_speaker 6,996 | Apache-2.0 | yes | no | Spoken general-QA benchmark with accented speakers [S51] | Test only | medium: general spoken test |

PriMock57 (CC BY 4.0, 8 h 38 m) and the Fareez OSCE set (CC0, about 55 h) remain the only openly licensed real consultation audio; both are English and covered in [asr-training-data.md](asr-training-data.md) [S52].

## 5. Medicine packaging, pills and prescription labels

No Malaysian, Malay or Mandarin (Simplified) medicine-package or pharmacy-label image set exists in the open, as far as I found [S1].

| Dataset | Lang on images | Size | Licence (as stated) | Commercial? | Gated | Contains | Quality notes | Fit |
|---|---|---|---|---|---|---|---|---|
| [`twinkle-ai/tw-drug-labels-vision`](https://huggingface.co/datasets/twinkle-ai/tw-drug-labels-vision) | zh-TW, English drug names | 44,663 documents: 22,704 leaflets, 21,959 cartons, ~67,947 pages | CC BY 4.0 | yes | no | Taiwan FDA open-data PDFs rendered to WebP at 90 dpi, with 17 extracted fields: licence number, Chinese and English names, form, strength, ingredients, indications, dose, warnings, storage and more [S53] | Flat scans, not photos; fields came from OCR plus an LLM | **medium-high** |
| [NLM C3PI pill images](https://data.lhncbc.nlm.nih.gov/public/Pills/) | imprints only | 4,000+ reference + 133,000 consumer photos (2.6 TB) | not stated | unclear (US government work, so likely public domain in the US, **judgement**) | no | US pills with NDC codes and names; project ended in 2018 [S54] | High quality | low: Sona should not identify loose pills by appearance (**judgement**) |
| [ePillID](https://github.com/usuyama/ePillID-benchmark) | imprints only | 13k images, 9,804 appearance classes | MIT (repo) | yes | no | Pill identification benchmark built from C3PI [S55] | — | low |
| [`mennox/Italian-OTC-medicines`](https://huggingface.co/datasets/mennox/Italian-OTC-medicines) | it | <1K images + JSON | Apache-2.0 | yes as stated; photo source not stated | no | Photos of over-the-counter packs, with barcode, SKU and product-summary fields [S56] | Real packs | low-medium |
| [`Malek-Messaoudi/Medicine_boxes_annotated`](https://huggingface.co/datasets/Malek-Messaoudi/Medicine_boxes_annotated) / [`Tunisian_Medicine_Boxes`](https://huggingface.co/datasets/Malek-Messaoudi/Tunisian_Medicine_Boxes) | not stated | ~1,100 / 365 files | none / MIT | unclear / yes | no | Box-detection boxes only, no text labels; the second card is empty [S56] | — | low |
| [`Ultralytics/Medical-pills`](https://huggingface.co/datasets/Ultralytics/Medical-pills) | — | 1K–10K | AGPL-3.0 | no (AGPL) | no | Pill detection [S56] | — | low |
| [`Elfsong/VAIPE_PILL`](https://huggingface.co/datasets/Elfsong/VAIPE_PILL) / [`VAIPE_P`](https://huggingface.co/datasets/Elfsong/VAIPE_P) | vi (**judgement**: VAIPE is a Vietnamese project; the cards are empty) | 11,002 pill images; 1,345 prescriptions | none | unclear | no | Pill photos and prescription images [S56] | — | low |
| [Pharmaceutical Drugs and Vitamins Synthetic Images](https://www.kaggle.com/datasets/vencerlanz09/pharmaceutical-drugs-and-vitamins-synthetic-images) (Kaggle) | — | 10 classes | CC BY-SA 3.0, plus a note to use it for education only | unclear | no | Philippine pill images [S56] | — | low |
| [Pills detection dataset](https://www.kaggle.com/datasets/alexanderyyy/pills-detection-dataset) (Kaggle) | — | 1.5 GB | CC BY-NC-SA 4.0 | no | no | Merged pill detection sets [S56] | — | low |

Handwritten-prescription sets on Hugging Face (`chinmays18/medical-prescription-dataset`, `yashmishra234/medical-prescription-dataset`) have no card or licence, so I skipped them.

## Licence red flags

1. **Scraped forum content under permissive tags.** HealthCareMagic's and iCliniq's terms forbid copying, republishing or "scraping" "for commercial or any other purpose" (quoted on the MedDialog card) [S20]. Their text appears in:
   - `OpenMed/MedDialog`, tagged Apache-2.0 "inherited from" `ruslanmv/ai-medical-chatbot`; that repo's Apache-2.0 covers code [S2][S5].
   - OpenMed's reasoning sets, as prompts. Two Mega rows I sampled match `lavita/ChatDoctor-HealthCareMagic-100k` word for word [S3][S5].
   - `II-Medical-Reasoning-SFT` (no licence; 215,647 ChatDoctor prompts) [S4], `UltraMedical` (MIT) [S26] and `shibing624/medical` (Apache-2.0) [S34].
2. **AfriMed-QA**: the HF card says CC BY-SA 4.0; the GitHub LICENSE says CC BY-NC-SA 4.0 [S22]. OpenMed's mirror states no licence [S8].
3. **ChatMed**: the HF card says CC BY 4.0; the README's disclaimer (in Chinese) says the resources are for academic research only and commercial use is strictly prohibited [S32].
4. **cMedQA2**: the LICENSE file is GPL-3.0; the README says the data "is available for non-commercial research" [S30]. `DISC-Med-SFT` (Apache-2.0) is rebuilt partly from it [S33].
5. **AlpaCare MedInstruct-52k**: the HF mirror has no licence; the GitHub data licence is CC BY-NC 4.0 [S27]. `UltraMedical` (MIT) includes it [S26].
6. **MultiMed**: tagged MIT on HF, but the paper justifies its YouTube audio as fair use for a "non-commercial scientific purpose" [S46].
7. **MedicationQA**: CC BY 4.0, yet its answers quote MedlinePlus drug pages. MedQuAD, from the same author, removed MedlinePlus drug answers "to respect the MedlinePlus copyright" [S11][S13].
8. **Medical Speech, Transcription, and Intent**: Kaggle says the licence is "specified in description", but the description gives none. Hugging Face mirrors relabel it Apache-2.0, "other" or nothing [S48].
9. **Missing licences on almost all Malaysian sets.** None of the mesolitica or Scicom chat and instruction sets in section 3 states a licence [S39][S40]. Across the orgs, licence tags are rare: mesolitica 14 of 206 datasets, malaysia-ai 18 of 108 (mostly CC BY-NC YouTube audio), Scicom-intl 9 of 44, huseinzol05 0 of 38 [S1]. Two more problems:
   - `Malaysian-Speech-Instructions` was voiced with Malaysian-F5-TTS-v2, which is CC BY-NC 4.0 [S39].
   - The UltraChat speech set uses Dewan Rakyat livestream clips as voice prompts.
10. **OpenMed/MedDialog card quality**: the card's example dialogue does not occur in the data. Replies contain doctors' names [S2].
11. **Dataset-level licences over mixed sources**: MultiCaRe (CC BY 4.0) and SynthVision (Apache-2.0) cover PubMed Central figures whose article licences vary. MultiCaRe keeps a licence field per row [S6][S7].
12. **Synthetic data made with closed models** but labelled Apache or MIT:
    - GPT-4o: medical-o1, VoiceAssistant-400K;
    - GPT-4: UltraMedical, MedText, HuatuoGPT2-140K;
    - ChatGPT: Huatuo26M-Lite, ChatMed;
    - Gemini: Synth-Manglish.

    **Judgement**: provider terms bind whoever generated the data, not us, but hospital legal review should confirm.
13. **Placeholder metadata**: SpokenMedicalQA's licence is only in the card YAML; its card body is empty and its loader's licence field reads "ddd" [S45].
14. **Rojak Medical Translation**: Kaggle's licence field says CC BY-SA 4.0, while its description suggests CC BY 4.0 or CC0 [S61].

## Open questions

- **SEA-Instruct-2602**: which model wrote the responses? Which component licences carry over (for example CC BY-SA from Infinity-Instruct)? How many Malay rows are health-tagged? Reading the full card needs you to accept its gating terms; I did not.
- **CC BY-SA and ODC-BY**: does our policy accept share-alike data (WikiDoc, Infinity-Instruct, Rojak) and attribution-only ODC-BY for the hospital model? Neither is on the policy list.
- **Closed-model outputs**: may the hospital model train on data generated by GPT-4o, GPT-4 or Gemini (see red flag 12)?
- **OpenMed provenance**: can we drop every Mega row whose prompt matches ChatDoctor, HealthCareMagic or iCliniq text, and is that enough to call the rest clean? Or will OpenMed publish per-row prompt sources?
- **Malaysian licences**: will mesolitica and Scicom state licences for their sets? Without one, nothing in section 3's Malaysian rows can reach the hospital model.
- **NPRA RiMUP leaflets**: Malaysia's drug regulator publishes consumer medication leaflets (RiMUP) in Malay and English for registered medicines, but its site says "All Rights Reserved" [S57]. With permission, they would be the best Malay source for both medicine answers and real label text (**judgement**). Ask NPRA.
- **MOH health LLM**: a 2025 MOSTI call funds an LLM built on Ministry of Health datasets, with Bahasa Melayu corpora. It says the model "could be used and shared with public and private sectors, eventually with open-source communities" [S58]. Is any of that data available to partners?
- **NUS IDS "Q&A Healthcare" (Malay)**: size and licence are not verified; the page blocks automated access [S59]. Check it in a browser.
- **HealthSearchQA**: does the CC BY 4.0 licence of the Nature article cover its supplementary data file [S14]?

## Sources

All Hugging Face facts were read on 2026-10-01. Dates in brackets are each card's last-modified date, or a repository's last push, as the source reports it.

- [S1] Hugging Face Hub API (`/api/datasets` with `author`, `search` and `full=true`), dataset-viewer `/size` and `/rows` endpoints, GitHub repository search and Kaggle dataset search, all queried 2026-10-01: https://huggingface.co/api/datasets?author=OpenMed&full=true&limit=500 , https://datasets-server.huggingface.co/size?dataset=OpenMed/MedDialog
- [S2] OpenMed/MedDialog card [2026-03-07] and data files `train.json`, `validation.json`: https://huggingface.co/datasets/OpenMed/MedDialog
- [S3] OpenMed Medical-Reasoning-SFT cards: Mega [2026-02-06], GPT-OSS-120B [2025-12-12], GPT-OSS-120B-Small [2026-01-04], GPT-OSS-120B-V2 [2026-02-05], Qwen3-Next-80B [2026-02-02], Nemotron-Nano-30B [2026-02-03], GLM_4.5_Air [2026-01-31], MiniMax-M2.1 [2026-02-01], Trinity-Mini [2026-01-31], Baichuan-M3-235B [2026-02-04]: https://huggingface.co/datasets/OpenMed/Medical-Reasoning-SFT-Mega , https://huggingface.co/datasets/OpenMed/Medical-Reasoning-SFT-GPT-OSS-120B
- [S4] Intelligent-Internet/II-Medical-Reasoning-SFT card [2025-07-03]: https://huggingface.co/datasets/Intelligent-Internet/II-Medical-Reasoning-SFT
- [S5] ChatDoctor data and code: lavita/ChatDoctor-HealthCareMagic-100k [2023-09-09] (parquet used for the prompt match), lavita/ChatDoctor-iCliniq [2023-09-11], ChatDoctor GitHub README [2024-05-17], ruslanmv/ai-medical-chatbot HF card [2024-03-23] and GitHub [2026-08-29]: https://huggingface.co/datasets/lavita/ChatDoctor-HealthCareMagic-100k , https://github.com/Kent0n-Li/ChatDoctor , https://huggingface.co/datasets/ruslanmv/ai-medical-chatbot , https://github.com/ruslanmv/ai-medical-chatbot
- [S6] OpenMed MultiCaRe cards [2025-09-07] and Zenodo record 13936721 (CC BY 4.0, 2024-12-13): https://huggingface.co/datasets/OpenMed/multicare-images , https://zenodo.org/records/13936721
- [S7] OpenMed SynthVision cards [2026-03-23]; seed cards eltorio/ROCO-radiology (MIT), flaviagiammarino/path-vqa (MIT), flaviagiammarino/vqa-rad (CC0): https://huggingface.co/datasets/OpenMed/synthvision-seeds
- [S8] OpenMed agab-db [2025-12-22], DDI-Corpus-Processed [2026-01-13], PubHealth-Processed [2026-01-14, no card], drugprot-parquet [2026-02-23], afrimedqa_v2 [2026-03-16], openmed-traces [2026-05-26]; PUBHEALTH GitHub (MIT): https://huggingface.co/OpenMed , https://github.com/neemakot/Health-Fact-Checking
- [S9] openmed-community datasets [2025-08-06 to 2026-01-09]: https://huggingface.co/datasets/openmed-community/med-synth-questions-qwen3-235b-a22b-2507
- [S10] OpenMed model listing (HF API, first 1,000 repos), checked 2026-10-01: https://huggingface.co/api/models?author=OpenMed&limit=1000
- [S11] MedQuAD GitHub README and LICENSE [2023-10-17]; lavita/MedQuAD [2023-12-22]; keivalya/MedQuad-MedicalQnADataset [2023-10-11]: https://github.com/abachaa/MedQuAD , https://huggingface.co/datasets/lavita/MedQuAD
- [S12] LiveQA Medical GitHub README [2026-05-13]; truehealth/liveqa [2023-06-12]: https://github.com/abachaa/LiveQA_MedicalTask_TREC2017
- [S13] MedicationQA GitHub README [2025-12-05]; truehealth/medicationqa [2023-06-12]: https://github.com/abachaa/Medication_QA_MedInfo2019 , https://huggingface.co/datasets/truehealth/medicationqa
- [S14] katielink/healthsearchqa [2023-08-24]; Singhal et al., "Large language models encode clinical knowledge", Nature (2023), data availability and licence: https://huggingface.co/datasets/katielink/healthsearchqa , https://www.nature.com/articles/s41586-023-06291-2
- [S15] K-QA GitHub README and MIT licence [2024-05-26]; paper arXiv 2401.14493: https://github.com/Itaymanes/K-QA
- [S16] openai/healthbench [2025-08-27] (file `2025-05-07-06-14-12_oss_eval.jsonl`); openai/simple-evals (MIT); Arora et al., "HealthBench", arXiv 2505.08775 (2025-05-13): https://huggingface.co/datasets/openai/healthbench , https://github.com/openai/simple-evals , https://arxiv.org/abs/2505.08775
- [S17] qiaojin/PubMedQA [2024-03-06]; pubmedqa GitHub (MIT): https://huggingface.co/datasets/qiaojin/PubMedQA
- [S18] openlifescienceai/medmcqa [2024-01-04]; medmcqa GitHub (MIT): https://huggingface.co/datasets/openlifescienceai/medmcqa , https://github.com/medmcqa/medmcqa
- [S19] GBaker/MedQA-USMLE-4-options [2023-01-24]; bigbio/med_qa [2026-09-04]; jind11/MedQA (MIT): https://github.com/jind11/MedQA
- [S20] UCSD26/medical_dialog card, "Licensing Information" [2023-09-18]: https://huggingface.co/datasets/UCSD26/medical_dialog
- [S21] medalpaca meadow cards [2023-04-06]; WikiDoc site footer (CC BY-SA 3.0, checked 2026-10-01); medAlpaca GitHub (GPL-3.0): https://huggingface.co/datasets/medalpaca/medical_meadow_wikidoc_patient_information , https://www.wikidoc.org/index.php/Main_Page
- [S22] intronhealth/afrimedqa_v2 API metadata [2025-06-17]; AfriMed-QA GitHub LICENSE [2025-09-17]: https://huggingface.co/datasets/intronhealth/afrimedqa_v2 , https://github.com/intron-innovation/AfriMed-QA
- [S23] FreedomIntelligence/medical-o1-reasoning-SFT [2025-04-22] and medical-o1-verifiable-problem [2024-12-30]; HuatuoGPT-o1 README; paper arXiv 2412.18925: https://github.com/FreedomIntelligence/HuatuoGPT-o1
- [S24] FreedomIntelligence/Medical-R1-Distill-Data and -Chinese [2025-02-22]
- [S25] UCSC-VLAA/MedReason [2025-05-27]; paper arXiv 2504.00993
- [S26] TsinghuaC3I/UltraMedical [2024-04-28]: https://huggingface.co/datasets/TsinghuaC3I/UltraMedical
- [S27] lavita/AlpaCare-MedInstruct-52k [2024-03-31]; AlpaCare GitHub README (data licence CC BY NC 4.0) [2025-02-08]: https://github.com/XZhang97666/AlpaCare
- [S28] BI55/MedText [2023-07-25]
- [S29] FreedomIntelligence Huatuo sets: huatuo_encyclopedia_qa [2023-05-17], huatuo_knowledge_graph_qa [2023-07-07], huatuo_consultation_qa [2023-05-17], Huatuo26M-Lite [2023-11-29], HuatuoGPT-sft-data-v1 [2023-06-01], HuatuoGPT2-SFT-GPT4-140K [2024-06-25]; HuatuoGPT GitHub README: https://github.com/FreedomIntelligence/HuatuoGPT
- [S30] cMedQA2 GitHub LICENSE and README [2019-01-09]; fzkuji/cMedQA2 [2024-12-07]: https://github.com/zhangsheng93/cMedQA2
- [S31] Suprit/CMtMedQA [2023-08-16]; Zhongjing README: https://github.com/SupritYoung/Zhongjing
- [S32] michaelwzhu/ChatMed_Consult_Dataset [2023-05-05]; ChatMed README disclaimer [2023-07-16]: https://github.com/michael-wzhu/ChatMed
- [S33] Flmc/DISC-Med-SFT [2023-08-29]; DISC-MedLLM README: https://github.com/FudanDISC/DISC-MedLLM
- [S34] shibing624/medical [2024-10-12]; Mxode/Chinese-Medical-Instruct-1M [2025-05-02]
- [S35] FreedomIntelligence/CMB [2024-04-05]; fzkuji/CMExam [2024-11-02]; CMExam GitHub (Apache-2.0)
- [S36] CohereLabs/Global-MMLU [2025-08-14] and its `ms/test` parquet: https://huggingface.co/datasets/CohereLabs/Global-MMLU
- [S37] UMxYTLAILabs/MalayMMLU [2025-08-18] and GitHub (BSD-3-Clause) [2026-02-13]; mesolitica/translated-MMLU [2024-03-18]; Scicom-intl/Translated-MalayMMLU [2025-12-09]; mesolitica/Speech-Instructions-MalayMMLU [2025-08-01]; openai/MMMLU (MIT); IndoHealth-NLP/NCD_Instruct-Tuning_Medical_QA_Indonesian [2026-09-14]: https://github.com/UMxYTL-AI-Labs/MalayMMLU
- [S38] Henrychur/MMedBench [2024-05-26]; HiTZ/MedExpQA [2024-11-11]; FreedomIntelligence/ApolloCorpus [2024-09-13] and ApolloMoEDataset [2024-10-18]; NLP-FBK/multilingual-medical-reasoning-traces [2026-03-02]
- [S39] mesolitica cards: Malaysian-SFT [2025-07-04], Malaysian-Ultrachat [2025-06-12], Malaysian-Instructions [2025-06-13], Malaysian-Multiturn-Chat-Assistant [2025-07-07], Malaysian-UltraChat-Speech-Multiturn-Instructions [2025-06-28], Malaysian-Speech-Instructions [2025-06-14], MaLLaM-2.5-Small-Manglish-QA [2024-11-17]; model cards Malaysian-F5-TTS-v2 (CC BY-NC 4.0) [2025-03-30], Malaysian-Dia-1.6B (no licence) [2025-06-18], Malaysian-Qwen2.5-72B-Instruct (no licence) [2025-05-27]: https://huggingface.co/mesolitica
- [S40] Scicom-intl cards: Malaysian-Local-Chinese-Instruction [2026-01-14], Malaysian-Instructions [2026-01-01], Malaysian-Reasoning [2026-01-25], Malaysian-Guardrail-QA [2025-12-08]: https://huggingface.co/Scicom-intl
- [S41] aisingapore/SEA-Instruct-2602 API metadata [2026-02-06] (card gated); aisingapore/Small-SEA-Instruct-2602 card and data file [2026-06-13]; DuDi paper arXiv 2606.04694 (2026-06-03): https://huggingface.co/datasets/aisingapore/SEA-Instruct-2602 , https://huggingface.co/datasets/aisingapore/Small-SEA-Instruct-2602
- [S42] CohereLabs/aya_dataset [2025-04-15] (train parquet) and aya_collection_language_split [2025-04-15]
- [S43] emhaihsan/Synth-Manglish [2026-05-03]
- [S44] HuggingFaceTB/smoltalk [2025-02-10]; gpt-omni/VoiceAssistant-400K [2024-09-13] and Mini-Omni paper arXiv 2408.16725; BAAI/Infinity-Instruct [2025-12-04]; m-a-p/COIG-CQIA [2024-04-18]
- [S45] SpokenMedicalQA/SpokenMedicalQA card and loader [2024-11-16]; Labrak et al., "Zero-Shot End-To-End Spoken Question Answering In Medical Domain", arXiv 2406.05876 (2024-06-09)
- [S46] leduckhai/MultiMed [2025-06-01] and MultiMed-ST [2025-11-09]; Le-Duc et al., arXiv 2409.14074 v3 (2025-05-15), Table 2 and Appendix B: https://arxiv.org/abs/2409.14074
- [S47] aline-gassenn/MedDialog-Audio [2025-10-12]
- [S48] Kaggle paultimothymooney/medical-speech-transcription-and-intent [2019-02-24]; HF mirrors Hani89/medical_asr_recording_dataset [2023-10-10], jarvisx17/Medical-ASR-EN [2023-01-30], Shamus/Medical_Speech_Transcription_and_Intent [2023-10-01], yashtiwari/PaulMooney-Medical-ASR-Data [2024-02-16]
- [S49] ekacare/eka-medical-asr-evaluation-dataset [2025-07-30]
- [S50] intronhealth/afrispeech-200 [2023-11-20]; intronhealth/afrispeech-dialog [2024-10-28]
- [S51] united-we-care/United-Syn-Med [2025-11-07]; Hani89/Synthetic-Medical-Speech-Dataset [2025-10-15]; HumynLabs medical audio sets [2025-07-28 to 2025-08-14]; hlt-lab/voicebench [2025-04-19]
- [S52] Earlier Sona research note: [asr-training-data.md](asr-training-data.md) (PriMock57, Fareez OSCE)
- [S53] twinkle-ai/tw-drug-labels-vision [2026-05-03]: https://huggingface.co/datasets/twinkle-ai/tw-drug-labels-vision
- [S54] NLM C3PI README files [2024-08-28]: https://data.lhncbc.nlm.nih.gov/public/Pills/AAREADME
- [S55] ePillID benchmark GitHub (MIT) [2022-04-13]: https://github.com/usuyama/ePillID-benchmark
- [S56] mennox/Italian-OTC-medicines [2026-01-22]; Malek-Messaoudi/Medicine_boxes_annotated and Tunisian_Medicine_Boxes [2026-01-06]; Ultralytics/Medical-pills [2025-02-10]; Elfsong/VAIPE_PILL and VAIPE_P [2026-03-18]; Kaggle vencerlanz09/pharmaceutical-drugs-and-vitamins-synthetic-images [2022-08-23]; Kaggle alexanderyyy/pills-detection-dataset [2026-02-19]
- [S57] NPRA RiMUP page (Malay) and footer "All Rights Reserved", checked 2026-10-01: https://www.npra.gov.my/index.php/my/consumers-2/maklumat/risalah-maklumat-ubat-untuk-pengguna-rimup/116.html
- [S58] MOSTI Strategic Research Fund RFP, "Development of LLM in the health sector for MOH application" (July 2025): https://sdb.mosti.gov.my/sdbcms/wp-content/uploads/2025/07/SRF-RFP-LLM-KESIHATAN-BI.pdf
- [S59] NUS IDS NZSG NLP data hub (known only from a search-result snippet; the page blocked automated access on 2026-10-01): https://ids.nus.edu.sg/microsites/nzsg-nlp/datahub.html
- [S60] Generator model licence fields on HF: openai/gpt-oss-120b (Apache-2.0), Qwen/Qwen3-Next-80B-A3B-Instruct (Apache-2.0), zai-org/GLM-4.5-Air (MIT), MiniMaxAI/MiniMax-M2.1 (modified MIT), arcee-ai/Trinity-Mini (OpenMDW-1.1), baichuan-inc/Baichuan-M3-235B (Apache-2.0), nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16 (NVIDIA Nemotron open model licence), checked 2026-10-01
- [S61] Kaggle wongjiarong/rojak-medical-translation-dataset-malaysia [2026-07-20]: https://www.kaggle.com/datasets/wongjiarong/rojak-medical-translation-dataset-malaysia
