"""Numbers as Sona says them: digits, doses, temperatures, dates and times written out as words in English, Malay or
Mandarin, so her live voice never reads a number it has only half seen. Live, the talker gets about a second of text at
a time and cannot look ahead: on 2 Oct box ④ heard "999" as "99" then "9" and "500mg" as "5" then "00mg"
(docs/minicpm-o-finetune.md, voice v3 plan). Words split cleanly across seconds; digits do not.

  spoken("Ambil 2 biji Paracetamol 500mg jika demam lebih 38°C.", "ms")
  -> "Ambil dua biji Paracetamol lima ratus miligram jika demam lebih tiga puluh lapan darjah Celsius."

Used for the live layer's training answers (python spoken.py <in.json> <out.json>, rows with messages and lang), for the
voice lines (lines_v3.py), and to compare an ASR's digits with spoken text when scoring.
ponytail: rules for what Sona says (doses, °C, dates, times, 999, codes like G6PD), not a general text normaliser.
"""
import json, re, sys

EN = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
EN_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
EN_ORD = {"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth", "nine": "ninth", "twelve": "twelfth"}
MS = "kosong satu dua tiga empat lima enam tujuh lapan sembilan".split()
ZH = "零一二三四五六七八九"
MONTHS_EN = "January February March April May June July August September October November December".split()
MONTHS_MS = "Januari Februari Mac April Mei Jun Julai Ogos September Oktober November Disember".split()


def en(n):
    if n < 20: return EN[n]
    if n < 100: return EN_TENS[n // 10] + ("-" + EN[n % 10] if n % 10 else "")
    for size, name in ((10**9, "billion"), (10**6, "million"), (1000, "thousand"), (100, "hundred")):
        if n >= size:
            rest = n % size
            return f"{en(n // size)} {name}" + ((" and " if size == 100 else " ") + en(rest) if rest else "")


def ms(n):
    if n < 10: return MS[n]
    if n == 10: return "sepuluh"
    if n == 11: return "sebelas"
    if n < 20: return f"{MS[n - 10]} belas"
    if n < 100: return f"{MS[n // 10]} puluh" + (f" {MS[n % 10]}" if n % 10 else "")
    for size, name in ((10**6, "juta"), (1000, "ribu"), (100, "ratus")):
        if n >= size:
            head = "se" + name if n // size == 1 else f"{ms(n // size)} {name}"
            return head + (f" {ms(n % size)}" if n % size else "")


def zh(n):
    if n == 0: return "零"
    if n >= 10**4:
        rest = n % 10**4
        return zh(n // 10**4) + "万" + (("零" if rest < 1000 else "") + zh(rest) if rest else "")
    out, zero = "", False
    for size, name in ((1000, "千"), (100, "百"), (10, "十"), (1, "")):
        d = n // size % 10
        if d:
            if zero: out += "零"
            digit = "两" if d == 2 and size >= 100 else ZH[d]
            out += ("" if d == 1 and size == 10 and n < 20 else digit) + name
            zero = False
        elif out:
            zero = True
    return out


def number(n, lang):
    return {"en": en, "ms": ms, "zh": zh}[lang](n)


def digits(s, lang):  # 999, years read as digits in Mandarin, codes: one digit at a time
    if lang == "zh": return "".join(ZH[int(c)] for c in s)
    return " ".join((EN if lang == "en" else MS)[int(c)] for c in s)


def decimal(s, lang):
    whole, frac = s.split(".")
    joiner = {"en": " point ", "ms": " perpuluhan ", "zh": "点"}[lang]
    return number(int(whole), lang) + joiner + digits(frac, lang)


def year(y, lang):
    if lang == "zh": return digits(str(y), "zh") + "年"
    if lang == "en" and 2010 <= y < 2100: return f"{en(y // 100)} {en(y % 100)}"
    return number(y, lang)


UNITS = {  # unit: (en singular, en plural, ms, zh)
    "mg": ("milligram", "milligrams", "miligram", "毫克"), "ml": ("millilitre", "millilitres", "mililiter", "毫升"),
    "kg": ("kilogram", "kilograms", "kilogram", "公斤"), "g": ("gram", "grams", "gram", "克"),
    "°C": ("degree Celsius", "degrees Celsius", "darjah Celsius", "摄氏度"), "°": ("degree", "degrees", "darjah", "度"),
    "mmol/L": ("millimole per litre", "millimoles per litre", "milimol per liter", "毫摩尔每升"),
    "mmHg": ("millimetre of mercury", "millimetres of mercury", "milimeter merkuri", "毫米汞柱"),
    "%": ("percent", "percent", "peratus", "%"),
}
UNIT_RE = "|".join(re.escape(u) for u in sorted(UNITS, key=len, reverse=True))


def amount(text, lang):
    """A number as words: decimal or whole."""
    return decimal(text, lang) if "." in text else number(int(text), lang)


def with_unit(m, lang):
    value, unit = m.group(1), m.group(2)
    if lang == "zh":
        return ("百分之" + amount(value, "zh")) if unit == "%" else amount(value, "zh") + UNITS[unit][3]
    words = UNITS[unit][0 if value in ("1", "1.0") else 1] if lang == "en" else UNITS[unit][2]
    return f"{amount(value, lang)} {words}"


def time_of(m, lang):
    h, mins, half = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "").lower().replace(".", "")
    if lang == "zh":
        return {"am": "上午", "pm": "下午"}.get(half, "") + zh(h) + "点" + (zh(mins) + "分" if mins else "")
    if lang == "ms":
        part = {"am": " pagi", "pm": " petang"}.get(half, "")
        return f"pukul {ms(h)}" + (f" {ms(mins)} minit" if mins else "") + part
    spoken_min = "" if not mins else (" oh " + en(mins) if mins < 10 else " " + en(mins))
    return en(h) + spoken_min + ({"am": " a m", "pm": " p m"}.get(half, "" if mins else " o'clock"))


def ordinal_en(n):
    words = en(n)
    last = re.split(r"[ -]", words)[-1]
    tail = EN_ORD.get(last) or (last[:-1] + "ieth" if last.endswith("y") else last + "th")
    return words[: len(words) - len(last)] + tail


def spoken(text, lang):
    """`text` with every number written as Sona would say it in `lang` ("en", "ms" or "zh")."""
    t = re.sub(r"(?<![\d.])(\d{1,2})\s*月\s*(\d{1,2})\s*([日号])", lambda m: zh(int(m.group(1))) + "月" + zh(int(m.group(2))) + m.group(3), text)
    t = re.sub(r"(?<!\d)(\d{4})\s*年", lambda m: year(int(m.group(1)), "zh"), t)
    half = r"[ap](?:\.m\.|m)"  # "am" or "a.m.", never a sentence's full stop after "am"
    t = re.sub(rf"(?<![\d.])(\d{{1,2}})[:.](\d{{2}})\s*({half})?(?![\d])|(?<![\d.])(\d{{1,2}})\s*({half})(?![a-z])",
               lambda m: time_of(re.match(rf"(\d+)(?:[:.](\d+))?\s*({half})?", m.group(0), re.I), lang), t, flags=re.I)
    t = re.sub(rf"(?<![A-Za-z\d.])(\d+(?:\.\d+)?)\s*({UNIT_RE})(?![A-Za-z])", lambda m: with_unit(m, lang), t)
    months = MONTHS_EN if lang == "en" else MONTHS_MS
    t = re.sub(r"(?<![\d.])(19\d\d|20\d\d)(?![\d.]*\d)", lambda m: year(int(m.group(1)), lang), t)
    if lang == "en":
        t = re.sub(r"\b(\d{1,2})(st|nd|rd|th)\b", lambda m: ordinal_en(int(m.group(1))), t)
        t = re.sub(rf"\b({'|'.join(MONTHS_EN)}) (\d{{1,2}})\b", lambda m: f"{m.group(1)} {ordinal_en(int(m.group(2)))}", t)
    t = re.sub(r"(?<![\d.])999(?![\d.]*\d)", lambda m: digits("999", lang), t)
    t = re.sub(r"(?<=[A-Za-z])(\d+)|(\d+)(?=[A-Za-z]{2,}\d*[A-Za-z]?\b)", lambda m: digits(m.group(0), lang) if lang == "zh" else f" {digits(m.group(0), lang)} ", t)  # G6PD, HbA1c
    t = re.sub(r"(?<![\d.])(\d+)\s*[-–]\s*(\d+)(?![\d.])",
               lambda m: number(int(m.group(1)), lang) + {"en": " to ", "ms": " hingga ", "zh": "到"}[lang] + number(int(m.group(2)), lang), t)
    t = re.sub(r"(?<![\d.])\d+(?:\.\d+)?(?![\d.]*\d)", lambda m: amount(m.group(0).rstrip("."), lang) + ("." if m.group(0).endswith(".") else ""), t)
    return t if lang == "zh" else re.sub(r" {2,}", " ", t)


def demo():
    cases = [
        ("Ambil 2 biji Paracetamol 500mg jika demam lebih 38°C.", "ms",
         "Ambil dua biji Paracetamol lima ratus miligram jika demam lebih tiga puluh lapan darjah Celsius."),
        ("If this is happening now, call 999 or go to the nearest emergency department.", "en",
         "If this is happening now, call nine nine nine or go to the nearest emergency department."),
        ("请记得10月15日要去心血管专科门诊复诊。", "zh", "请记得十月十五日要去心血管专科门诊复诊。"),
        ("如果正在发生，请立即拨打999。", "zh", "如果正在发生，请立即拨打九九九。"),
        ("Your appointment is on October 8th 2026 at 9:30am.", "en",
         "Your appointment is on October eighth twenty twenty-six at nine thirty a m."),
        ("Temujanji pada 8 Oktober 2026, pukul 10 pagi.", "ms", "Temujanji pada lapan Oktober dua ribu dua puluh enam, pukul sepuluh pagi."),
        ("血糖3.8确实太低了。每次5ml即可。", "zh", "血糖三点八确实太低了。每次五毫升即可。"),
        ("Take 1-2 tablets, 2.5mg each.", "en", "Take one to two tablets, two point five milligrams each."),
        ("G6PD and HbA1c", "en", "G six PD and HbA one c"),
        ("Rest 7 days, 121 tablets left.", "ms", "Rest tujuh days, seratus dua puluh satu tablets left."),
        ("体重200公斤，1250元，10003", "zh", "体重两百公斤，一千两百五十元，一万零三"),
    ]
    for text, lang, want in cases:
        got = spoken(text, lang)
        assert got == want, f"\n{text}\n got: {got}\nwant: {want}"
    print("spoken.py: all", len(cases), "cases ok")


if __name__ == "__main__":
    if len(sys.argv) == 3:  # rewrite the answers of a live training set
        rows = json.load(open(sys.argv[1]))
        for r in rows:
            r["messages"][-1]["content"] = spoken(r["messages"][-1]["content"], r["lang"] if r["lang"] in ("en", "ms", "zh") else "en")
        json.dump(rows, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
        print(f"wrote {len(rows)} rows to {sys.argv[2]}")
    else:
        demo()
