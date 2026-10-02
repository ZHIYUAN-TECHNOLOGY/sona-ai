"""Synthetic Malaysian medicine-label photos with questions and answers, for MiniCPM-o's eyes (docs/minicpm-o-finetune.md, stage 1).

Renders medicine boxes, blister strips, bottles and pharmacy dispensing labels in Malay, English and Chinese from the demo
drug table (data/drugs.csv, take-home forms only), makes them look like phone photos (tilt, blur, glare, shadow, a finger),
and writes LLaMA-Factory image rows. One in ten is unreadable on purpose: the right answer is to ask for a clearer photo.
Answers say only what the label shows. 300 images are held out as a test set with the exact expected fields.

Usage: python render.py [count=3000] [--upload]   (pillow, numpy, huggingface_hub; CPU only)
Output: ~/zyt/data/sona-omni/eyes/see/ (images/, train.json, test.json, dataset_info.json) and samples/.
"""
import csv, json, random, re, sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

REPO = Path(__file__).resolve().parents[2]
OUT = Path.home() / "zyt/data/sona-omni/eyes"
SEE = OUT / "see"
TEST = 300
SUP = "/System/Library/Fonts/Supplemental/"
LATIN = [SUP + "Arial.ttf", SUP + "Verdana.ttf", SUP + "Tahoma.ttf", "/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Avenir Next.ttc"]
LATIN_BOLD = [SUP + "Arial Bold.ttf", SUP + "Verdana Bold.ttf", SUP + "Tahoma Bold.ttf", SUP + "Trebuchet MS Bold.ttf"]
PRINTER = [SUP + "Courier New.ttf", SUP + "Courier New Bold.ttf"]  # dispensing-label printers
CJK = ["/System/Library/Fonts/Hiragino Sans GB.ttc", "/System/Library/Fonts/STHeiti Light.ttc", SUP + "Songti.ttc", "/Library/Fonts/Arial Unicode.ttf"]
CJK_BOLD = ["/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]

ZH_NAME = {  # standard Chinese generic names, shown beside the Latin name on Chinese labels
    "paracetamol": "扑热息痛", "azithromycin": "阿奇霉素", "clarithromycin": "克拉霉素", "doxycycline": "多西环素",
    "amoxicillin": "阿莫西林", "co-amoxiclav": "阿莫西林克拉维酸钾", "salbutamol": "沙丁胺醇", "cetirizine": "西替利嗪",
    "prednisolone": "泼尼松龙", "furosemide": "呋塞米", "metformin": "二甲双胍", "insulin": "胰岛素",
    "potassium-chloride": "氯化钾", "ondansetron": "昂丹司琼", "omeprazole": "奥美拉唑", "enoxaparin": "依诺肝素", "amlodipine": "氨氯地平",
}
# form keyword -> (kind, Malay unit, English unit, Chinese unit, Malay form, English form, Chinese form)
FORMS = [("inhaler", "inhaler", "kali", "puff", "下", "inhaler", "inhaler", "吸入剂"),
         ("syringe", "syringe", "suntikan", "injection", "支", "picagari", "prefilled syringe", "预充注射器"),
         ("units/mL", "insulin", "unit", "unit", "单位", "suntikan", "injection", "注射液"),
         ("capsule", "pill", "kapsul", "capsule", "粒", "kapsul", "capsule", "胶囊"),
         ("tablet", "pill", "biji", "tablet", "粒", "tablet", "tablet", "片")]


def drugs():
    """Take-home medicines from the demo drug table: id, Latin name, strength and its form."""
    rows = csv.DictReader(l for l in (REPO / "data/drugs.csv").read_text().splitlines() if not l.startswith("#"))
    out = []
    for r in rows:
        f = r["formulation"].split(";")[0].strip()  # "625 mg tablet; 1.2 g injection" -> the oral part
        form = next((x for x in FORMS if x[0] in f), None)
        m = re.match(r"([\d.]+ ?(?:mg/[\d.]+ ?mL|units/mL|microgram|mg|g))", f)
        if form and m and "nebuliser" not in f:
            out.append({"id": r["id"], "name": r["name"], "strength": m.group(1), "form": form})
    return out


FREQ = [(1, "sekali", "once a day", "一"), (2, "2 kali", "twice a day", "两"), (3, "3 kali", "three times a day", "三"), (4, "4 kali", "four times a day", "四")]
WHEN = [("selepas makan", "after food", "饭后"), ("sebelum makan", "before food", "饭前"), ("", "", ""), ("pada waktu malam", "at night", "睡前")]


def instruction(d, rnd):
    """The same instruction in Malay, English and Chinese, as a pharmacy would print it."""
    kind = d["form"][1]
    if kind == "inhaler":
        n = rnd.choice([1, 2])
        return {"ms": f"Sedut {n} kali apabila sesak nafas", "en": f"Inhale {n} puff{'s' * (n > 1)} when breathless", "zh": f"气喘时吸{n}下"}
    if kind == "insulin":
        n = rnd.choice([6, 8, 10, 12, 14])
        return {"ms": f"Suntik {n} unit sebelum makan malam", "en": f"Inject {n} units before dinner", "zh": f"晚餐前注射{n}单位"}
    if kind == "syringe":
        return {"ms": "Suntik sekali sehari di bawah kulit", "en": "Inject once a day under the skin", "zh": "每日一次，皮下注射"}
    n, (k, fms, fen, fzh), (wms, wen, wzh) = rnd.choice([1, 1, 2]), rnd.choice(FREQ), rnd.choice(WHEN)
    unit_en = d["form"][3] + ("s" if n > 1 else "")
    return {"ms": f"Ambil {n} {d['form'][2]} {fms} sehari {wms}".strip(), "en": f"Take {n} {unit_en} {fen} {wen}".strip(),
            "zh": f"每日{fzh}次，每次{n}{d['form'][4]}" + (f"，{wzh}" if wzh else "")}


PATIENTS = ["Aminah binti Yusof", "Tan Mei Ling", "Rajesh a/l Kumar", "Siti Nur Aisyah binti Rahman", "Lim Wei Jie", "Muthu a/l Rajan",
            "Nurul Huda binti Ahmad", "Wong Kah Wai", "Kavitha a/p Subramaniam", "Ahmad Faizal bin Hassan", "Chong Siew Lan", "Farah binti Ismail"]
PLACES = ["Hospital Sona", "Klinik Kesihatan Taman Sona", "Farmasi Komuniti Sona", "Poliklinik Sona Jaya"]


def fit(draw, text, paths, size, width, rnd):
    """A font from `paths` at the largest size up to `size` that fits `width`."""
    path = rnd.choice(paths)
    while size > 10:
        f = ImageFont.truetype(path, size)
        if draw.textlength(text, font=f) <= width: return f
        size -= 2
    return ImageFont.truetype(path, size)


def label(d, kind, lang, ins, rnd):
    """Draw one label. Returns the image and the lines it shows, top to bottom (what a careful reader would say)."""
    zh = "zh" in lang
    reg, bold = (CJK, CJK_BOLD) if zh else (LATIN, LATIN_BOLD)
    if kind == "dispensing" and not zh and rnd.random() < 0.6: reg = bold = PRINTER
    w, h = {"dispensing": (900, 560), "box": (900, 560), "bottle": (900, 500), "blister": (900, 420)}[kind]
    paper = (rnd.randint(235, 255), rnd.randint(235, 255), rnd.randint(228, 252))
    img = Image.new("RGB", (w, h), (196, 199, 204) if kind == "blister" else paper)
    dr = ImageDraw.Draw(img)
    name = d["name"] + (f" {ZH_NAME[d['id']]}" if zh else "")
    hue = tuple(rnd.randint(30, 200) for _ in range(3))
    lines, y = [], 30

    def put(text, paths, size, color=(20, 20, 20), x=40):
        nonlocal y
        f = fit(dr, text, paths, size, w - x - 30, rnd)
        dr.text((x, y), text, font=f, fill=color)
        y += f.size + 14
        lines.append(text)

    qty = rnd.choice([10, 14, 20, 28, 30])
    unit_word = {"ms": d["form"][2], "en": d["form"][3] + "s", "zh": d["form"][4], "ms+en": d["form"][2]}[lang]
    if d["form"][1] == "insulin":  # insulin goes home as pens, not as a count of units
        qty = rnd.randint(1, 3)
        unit_word = {"ms": "pen", "en": "pen" + "s" * (qty > 1), "zh": "支", "ms+en": "pen"}[lang]
    exp = f"EXP {rnd.randint(1, 12):02d}/{rnd.randint(2027, 2029)}"
    mal = f"MAL{rnd.randint(2019, 2026)}{rnd.randint(1000000, 9999999)}{rnd.choice('AXT')}"
    if kind == "dispensing":
        put(rnd.choice(PLACES), bold, 34, hue)
        who = {"ms": "Nama", "en": "Name", "zh": "姓名", "ms+en": "Nama/Name"}[lang]
        put(f"{who}: {rnd.choice(PATIENTS)}", reg, 28)
        put(f"{name} {d['strength']}", bold, 44)
        for l in (["ms", "en"] if lang == "ms+en" else [lang]): put(ins[l], bold if l != "en" or lang == "en" else reg, 36)
        put(f"{qty} {unit_word}  ·  {exp}", reg, 26)
    else:
        if kind == "blister":
            for i in range(5):
                for j in range(2):
                    cx, cy = 120 + i * 160, 250 + j * 95
                    dr.ellipse([cx - 45, cy - 30, cx + 45, cy + 30], fill=(214, 216, 220), outline=(150, 152, 156), width=3)
        else:
            dr.rectangle([0, 0, w, 18], fill=hue) if kind == "box" else dr.rectangle([0, 0, w, 90], fill=hue)
            y = 110 if kind == "bottle" else 40
        put(name, bold, 66 if kind != "blister" else 48, (25, 25, 25) if kind != "bottle" else hue)
        form = {"ms": d["form"][5], "en": d["form"][6], "zh": d["form"][7], "ms+en": d["form"][5]}[lang]
        put(f"{d['strength']} {form}", reg, 40)
        if kind != "blister": put(f"{qty} {unit_word}", reg, 32)
        put(f"{mal}   {exp}" if kind != "blister" else exp, reg, 24, (70, 70, 70))
    if kind != "blister":  # a label is only as tall as its text
        img = img.crop((0, 0, w, min(h, y + 26)))
    if kind == "dispensing":
        ImageDraw.Draw(img).rectangle([8, 8, w - 9, img.height - 9], outline=(60, 60, 60), width=3)
    return img, lines


def coeffs(src, dst):
    """PIL perspective coefficients that map the output quad `dst` back onto the label corners `src`."""
    a, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        a += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]
        b += [u, v]
    return np.linalg.solve(np.array(a, float), np.array(b, float)).tolist()


def photo(lab, rnd, unreadable):
    """Place the label on a table, in a hand or on cloth, tilted and lit like a phone photo."""
    W, H = 1024, 768
    base = np.array([rnd.randint(60, 200) for _ in range(3)], float)
    bg = base + np.random.default_rng(rnd.randint(0, 1 << 30)).normal(0, rnd.uniform(3, 14), (H, W, 3))
    bg += np.linspace(-25, 25, W)[None, :, None] * rnd.choice([-1, 1])
    if rnd.random() < 0.4:  # wood grain
        bg += 14 * np.sin(np.linspace(0, rnd.uniform(30, 90), H) + np.random.default_rng(rnd.randint(0, 1 << 30)).normal(0, 0.3, H))[:, None, None]
    canvas = Image.fromarray(np.clip(bg, 0, 255).astype("uint8"))
    w, h = lab.size
    s = rnd.uniform(0.62, 0.88) * W / w
    cw, ch = w * s, h * s
    x0, y0 = (W - cw) / 2 + rnd.uniform(-60, 60), (H - ch) / 2 + rnd.uniform(-50, 50)
    j = lambda: rnd.uniform(-0.07, 0.07) * cw
    dst = [(x0 + j(), y0 + j()), (x0 + cw + j(), y0 + j()), (x0 + cw + j(), y0 + ch + j()), (x0 + j(), y0 + ch + j())]
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    warped = lab.convert("RGBA").transform((W, H), Image.PERSPECTIVE, coeffs(src, dst), Image.BICUBIC)
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).polygon([(x + 12, y + 14) for x, y in dst], fill=(0, 0, 0, 90))
    canvas.paste(shadow.filter(ImageFilter.GaussianBlur(10)), (0, 0), shadow.filter(ImageFilter.GaussianBlur(10)))
    canvas.paste(warped, (0, 0), warped)
    over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(over)
    if rnd.random() < 0.5:  # light falling across part of it
        od.polygon([(rnd.uniform(0, W), 0), (W, 0), (W, rnd.uniform(0, H))], fill=(0, 0, 0, rnd.randint(30, 90)))
    if rnd.random() < 0.45:  # glare
        gx, gy, gr = rnd.uniform(x0, x0 + cw), rnd.uniform(y0, y0 + ch), rnd.uniform(40, 120)
        od.ellipse([gx - gr, gy - gr * 0.6, gx + gr, gy + gr * 0.6], fill=(255, 255, 255, rnd.randint(50, 110)))
    if rnd.random() < 0.25:  # a thumb holding the bottom-right corner, clear of the text
        cx, cy = dst[2]
        skin = rnd.choice([(224, 172, 140), (198, 134, 100), (141, 85, 60), (241, 194, 160)])
        od.ellipse([cx - 45, cy - 25, cx + 75, cy + 110], fill=skin + (255,))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), over.filter(ImageFilter.GaussianBlur(8))).convert("RGB")
    canvas = ImageEnhance.Brightness(canvas).enhance(rnd.uniform(0.75, 1.15))
    r, g, b = canvas.split()
    warm = rnd.uniform(0.92, 1.08)
    canvas = Image.merge("RGB", (r.point(lambda v: min(255, v * warm)), g, b.point(lambda v: min(255, v / warm))))
    canvas = canvas.rotate(rnd.uniform(-8, 8), resample=Image.BICUBIC, fillcolor=tuple(int(c) for c in base))
    canvas = canvas.filter(ImageFilter.GaussianBlur(rnd.uniform(0, 1.0)))
    if unreadable:  # too blurred, too dark, or only a scrap in view
        how = rnd.choice(["blur", "dark", "crop"])
        if how == "blur": canvas = canvas.filter(ImageFilter.GaussianBlur(rnd.uniform(7, 11)))
        if how == "dark": canvas = ImageEnhance.Brightness(canvas).enhance(rnd.uniform(0.06, 0.14)).filter(ImageFilter.GaussianBlur(2))
        if how == "crop":
            cx, cy = rnd.uniform(0, W * 0.7), rnd.uniform(0, H * 0.7)
            canvas = canvas.crop((cx, cy, cx + W * 0.3, cy + H * 0.3)).resize((W, H)).filter(ImageFilter.GaussianBlur(3))
    return canvas.resize((896, 672))


Q = {
    "read": {"en": "Can you read this label for me?", "ms": "Tolong baca label ubat ini.", "zh": "请帮我读一下这个药的标签。", "mix": "Can tolong read this label for me ah?"},
    "what": {"en": "What medicine is this?", "ms": "Ini ubat apa?", "zh": "这是什么药？", "mix": "This one ubat apa ah?"},
    "how": {"en": "How do I take this?", "ms": "Macam mana nak ambil ubat ni?", "zh": "这个药怎么用？", "mix": "This one how to makan ah?"},
}
UNREADABLE = {"en": "I can't read this label clearly. Please take another photo in good light, with the whole label in view.",
              "ms": "Saya tidak dapat membaca label ini dengan jelas. Sila ambil gambar lagi dalam cahaya yang terang, dengan seluruh label kelihatan.",
              "zh": "我看不清这个标签。请在光线充足的地方再拍一张，并让整个标签都在画面里。"}


def qa(d, kind, lang, ins, lines, all_drugs, rnd, unreadable):
    """One question in Malay, English, Chinese or Manglish, and the answer in the asker's language from the label alone."""
    ql = rnd.choices(["en", "ms", "zh", "mix"], [0.35, 0.3, 0.2, 0.15])[0]
    al = "en" if ql == "mix" else ql
    t = rnd.choice(["read", "what", "how", "mine"])
    name = d["name"] + (f" ({ZH_NAME[d['id']]})" if al == "zh" else "")
    if t == "mine":
        other = [x for x in all_drugs if x["id"] != d["id"]]
        case = rnd.choices(["yes", "strength", "no"], [0.5, 0.2, 0.3])[0]
        plan = rnd.sample(other, rnd.randint(0, 2))
        plan_strength = d["strength"]
        if case == "strength":
            n, unit = re.match(r"([\d.]+)(.*)", d["strength"]).groups()
            plan_strength = f"{float(n) * 2:g}{unit}"
        if case != "no": plan.insert(rnd.randint(0, len(plan)), {**d, "strength": plan_strength})
        plan_text = ", ".join(f"{x['name']} {x['strength']}" for x in plan) or "-"
        q = {"en": f"My plan says: {plan_text}. Is this one of my medicines?", "ms": f"Pelan saya: {plan_text}. Adakah ini ubat saya?",
             "zh": f"我的出院计划：{plan_text}。这是我的药吗？", "mix": f"My plan: {plan_text}. This one my ubat or not ah?"}[ql]
        a = {"yes": {"en": f"Yes. This is {name} {d['strength']}, which is on your plan.", "ms": f"Ya. Ini {name} {d['strength']}, yang ada dalam pelan anda.",
                     "zh": f"是的。这是{name} {d['strength']}，在您的计划里。"},
             "strength": {"en": f"The name matches your plan, but this is {d['strength']} and your plan says {plan_strength}. Please check with your pharmacist or care team before taking it.",
                          "ms": f"Nama ubat sama dengan pelan anda, tetapi ini {d['strength']} dan pelan anda tulis {plan_strength}. Sila semak dengan ahli farmasi atau pasukan penjagaan anda sebelum mengambilnya.",
                          "zh": f"药名和您的计划相同，但这是{d['strength']}，而您的计划写的是{plan_strength}。服用前请先向药剂师或医护团队确认。"},
             "no": {"en": f"No. This is {name} {d['strength']}, which is not on your plan. Please check with your care team before taking it.",
                    "ms": f"Tidak. Ini {name} {d['strength']}, yang tiada dalam pelan anda. Sila semak dengan pasukan penjagaan anda sebelum mengambilnya.",
                    "zh": f"不是。这是{name} {d['strength']}，不在您的计划里。服用前请先向医护团队确认。"}}[case][al]
    else:
        q = Q[t][ql]
        if t == "read":
            a = {"en": "It says:\n", "ms": "Labelnya tertulis:\n", "zh": "标签上写着：\n"}[al] + "\n".join(lines)
        elif t == "what":
            form = {"en": d["form"][6], "ms": d["form"][5], "zh": d["form"][7]}[al]
            a = {"en": f"This is {name} {d['strength']} {form}.", "ms": f"Ini {name} {d['strength']} ({form}).", "zh": f"这是{name} {d['strength']}{form}。"}[al]
        elif kind == "dispensing":
            printed = " / ".join(ins[l] for l in (["ms", "en"] if lang == "ms+en" else [lang]))
            a = {"en": f"The label says “{printed}”. That means: {ins['en'].lower()}.",
                 "ms": f"Label itu tertulis “{printed}”. Maksudnya: {ins['ms'][0].lower() + ins['ms'][1:]}.",
                 "zh": f"标签上写着“{printed}”。意思是：{ins['zh']}。"}[al]
        else:
            pack = {"box": ("box", "Kotak", "盒子"), "bottle": ("bottle", "Botol", "瓶子"), "blister": ("strip", "Jalur ubat", "药板")}[kind]
            a = {"en": f"This {pack[0]} doesn't show how to take it. Check your pharmacy label, or ask your care team.",
                 "ms": f"{pack[1]} ini tidak menunjukkan cara mengambilnya. Semak label farmasi anda, atau tanya pasukan penjagaan anda.",
                 "zh": f"这个{pack[2]}上没有写使用方法。请看药房标签，或询问您的医护团队。"}[al]
    return q, (UNREADABLE[al] if unreadable else a)


DRUGS = drugs()


def make(i):
    """Image i (its own seed, so runs repeat and split across processes) and its row; the first TEST rows carry the answer key."""
    rnd = random.Random(1000 + i)
    d = rnd.choice(DRUGS)
    kind = rnd.choices(["dispensing", "box", "blister", "bottle"], [0.45, 0.25, 0.15, 0.15])[0]
    if d["form"][1] != "pill" and kind == "blister": kind = "box"
    lang = rnd.choices(["ms", "en", "zh", "ms+en"], [0.35, 0.2, 0.15, 0.3] if kind == "dispensing" else [0.2, 0.6, 0.2, 0])[0]
    ins = instruction(d, rnd)
    unreadable = rnd.random() < 0.1
    lab, lines = label(d, kind, lang, ins, rnd)
    img = photo(lab, rnd, unreadable)
    rel = f"images/see_{i:05d}.jpg"
    img.save(SEE / rel, quality=rnd.randint(72, 92))
    if i < 12: img.save(OUT / "samples" / f"sample_{i:02d}_{kind}_{lang.replace('+', '-')}{'_unreadable' if unreadable else ''}.jpg", quality=88)
    q, a = qa(d, kind, lang, ins, lines, DRUGS, rnd, unreadable)
    row = {"messages": [{"role": "user", "content": "<image>" + q}, {"role": "assistant", "content": a}], "images": [rel]}
    if i < TEST:
        printed = " / ".join(ins[l] for l in (["ms", "en"] if lang == "ms+en" else [lang])) if kind == "dispensing" else None
        row["expected"] = {"name": d["name"], "strength": d["strength"], "instruction": printed, "kind": kind, "label_lang": lang, "unreadable": unreadable}
    return row


def main(n, upload):
    (SEE / "images").mkdir(parents=True, exist_ok=True)
    (OUT / "samples").mkdir(parents=True, exist_ok=True)
    with Pool(8) as pool:
        rows = pool.map(make, range(n), chunksize=20)
    test, train = rows[:TEST], rows[TEST:]
    (SEE / "train.json").write_text(json.dumps(train, ensure_ascii=False))
    (SEE / "test.json").write_text(json.dumps(test, ensure_ascii=False))
    info = {"sona_see": {"file_name": "train.json", "formatting": "sharegpt", "columns": {"messages": "messages", "images": "images"},
                         "tags": {"role_tag": "role", "content_tag": "content", "user_tag": "user", "assistant_tag": "assistant"}}}
    info["sona_see_test"] = {**info["sona_see"], "file_name": "test.json"}
    (SEE / "dataset_info.json").write_text(json.dumps(info, indent=2))
    check(train, test, n)
    if upload:
        from huggingface_hub import HfApi
        api = HfApi(token=(Path.home() / ".cache/huggingface/token_write").read_text().strip())
        info = api.upload_folder(repo_id="zhiyuantechnology/sona-minicpmo-data", repo_type="dataset", folder_path=str(SEE),
                                 path_in_repo="see", commit_message=f"see: {len(train)} train + {len(test)} test synthetic medicine-label photos")
        print("uploaded", info.oid)


def check(train, test, n):
    """The smallest proof the rows are usable: counts, one image per <image>, files exist, read answers hold the drug name."""
    assert len(test) == TEST and len(train) == n - TEST, (len(train), len(test))
    for r in train + test:
        assert r["messages"][0]["content"].count("<image>") == len(r["images"]) == 1
        assert (SEE / r["images"][0]).exists()
    for r in test:
        e = r["expected"]
        assert e["name"] and e["strength"] and (e["kind"] != "dispensing" or e["instruction"])
    reads = [r for r in train if r["messages"][1]["content"].split("\n")[0] in ("It says:", "Labelnya tertulis:", "标签上写着：")]
    assert reads and all(any(d["name"] in r["messages"][1]["content"] for d in DRUGS) for r in reads)
    print(f"ok: {len(train)} train, {len(test)} test, {sum(r['expected']['unreadable'] for r in test)} unreadable in test")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(int(args[0]) if args else 3000, "--upload" in sys.argv)
