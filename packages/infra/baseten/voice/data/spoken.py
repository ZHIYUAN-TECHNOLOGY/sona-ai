"""Which of Sona's three languages a line for her voice is written in, so it is spoken from the reference clip in that
language (data/anchors: a clip in another language cost words, tools/tts-eval/speaker_gen.py). An answer is written in
one language (docs/tts-training.md), so a count of each language's commonest words decides. Run this file to check it."""
import re

MALAY = set("""anda yang dan ubat makan sila tidak tak untuk dengan ini itu atau jika kalau selepas sebelum setiap hari
kali pada akan boleh jangan saya kami sudah telah ambil minum biji perlu hubungi segera jumpa temu janji pagi petang
malam bersama ialah adalah lagi dalam ke di dari juga masih sakit rasa satu dua tiga waktu air dah sebab semalam
sekarang berbanding kaki katil ada apa bila atas supaya macam mana tu nampak sikit banyak masa masuk tanda lebih
kurang berapa tiada melalui minta doktor encik puan makcik pakcik""".split())
ENGLISH = set("""the and you your take with for is are of to a in on if please every after before day times will can
do not call this that it at or have has be one two three when water""".split())


def lang_of(text: str) -> str:
    """ "zh" for any Chinese character; otherwise Malay only when it has more Malay words than English ones."""
    if re.search(r"[一-鿿]", text):
        return "zh"
    words = re.findall(r"[a-z]+", text.lower())
    # ponytail: two word lists, so a line of names and numbers alone reads as English; pass the language in from the
    # caller (care.speak and the call both know it) if lines are ever misread.
    return "ms" if sum(w in MALAY for w in words) > sum(w in ENGLISH for w in words) else "en"


if __name__ == "__main__":
    assert lang_of("您可以服用扑热息痛退烧，每六小时一克。") == "zh"
    assert lang_of("Anda boleh ambil paracetamol satu gram setiap enam jam jika perlu.") == "ms"
    assert lang_of("You can take paracetamol for your fever. Take 1 gram every 6 hours if you need it.") == "en"
    assert lang_of("Metformin anda ialah 500 miligram, dua kali sehari bersama makanan.") == "ms"
    assert lang_of("Hai.") == "en"
    print("spoken ok")
