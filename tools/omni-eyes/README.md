# MiniCPM-o eyes data: medicine-label photos

Synthetic training data for MiniCPM-o's vision part (stage 1 of the [fine-tune run sheet](../../docs/minicpm-o-finetune.md)). Everything is made up: generic names and strengths from the demo drug table (`data/drugs.csv`, the 17 take-home forms), fictional MAL numbers, patients and clinics.

- **What it draws:** medicine boxes, blister strips, bottles and pharmacy dispensing labels, in Malay, English, Chinese (with the Chinese generic name) and bilingual Malay/English.
- **How it looks like a photo:** perspective tilt, rotation, shadow, glare, blur, warm or cool light, wood or cloth backgrounds, and sometimes a thumb on a corner.
- **What it asks:** read the label; what is this medicine; how do I take it; and "is this my medicine?" against a short plan in the question. Questions come in Malay, English, Chinese or Manglish, and answers follow the asker's language.
- **What the answers say:** only what the label shows. A box with no instructions says so, and a strength that differs from the plan is pointed out.
- **Unreadable images:** one in ten is too blurred, too dark or cropped to a scrap. The answer asks for a clearer photo.
- **Test set:** 300 held-out images (`test.json`), each with an `expected` answer key: `name`, `strength`, `instruction` (dispensing labels only), `kind`, `label_lang` and `unreadable`.

## Run

```sh
uv run --with pillow --with numpy --with huggingface_hub python tools/omni-eyes/render.py 3000 [--upload]
```

- **Time:** about 1 minute on 8 CPU processes.
- **Determinism:** each image has its own seed, so a rerun gives the same images.
- **Output:** `~/zyt/data/sona-omni/eyes/see/` (`images/`, `train.json`, `test.json`, `dataset_info.json`), plus 12 picks in `samples/`.
- **Upload:** `--upload` pushes `see/` to the private dataset `zhiyuantechnology/sona-minicpmo-data` with the write token in `~/.cache/huggingface/token_write`.

## LLaMA-Factory

Point `dataset_dir` at the `see/` folder of the dataset, then use `dataset: sona_see`. Image paths are relative to that folder.

Each row has one image and one question:

```json
{"messages": [{"role": "user", "content": "<image>Ini ubat apa?"}, {"role": "assistant", "content": "Ini Amlodipine 5 mg (tablet)."}], "images": ["images/see_00042.jpg"]}
```
