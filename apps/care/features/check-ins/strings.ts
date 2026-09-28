import { addStrings } from "@/lib/i18n";
import "@/lib/strings";

/**
 * Check-ins' chrome: the card around the question, the done state and past check-ins. The answer words
 * themselves (faces, quick replies, the 999 lines) live in model.ts, per language, since they are sent.
 */
addStrings({
  en: {
    "ci.thanks": "Thank you", "ci.willSee": "Your care team will see this today.",
    "ci.told": "Your care team has been told", "ci.callAbout": "They will call you today about: {about}.", "ci.call": "They will call you today.",
    "ci.waiting": "Waiting for your answer", "ci.coming": "Coming {day}", "ci.allFine": "All fine · your care team can see it",
    "ci.followedUp": "Your care team followed up", "ci.wasTold": "Your care team was told",
    "ci.noneYet": "None yet. We'll ask on day 2 and day 7 after you go home.", "ci.answered": "{n} of {of} answered",
    "ci.oneWaiting": " · one waiting for you", "ci.nextOn": " · next {day}",
    "ci.today": "Today", "ci.couldNotLoad": "Your check-ins could not load. Try again in a moment.", "ci.past": "Past check-ins",
    "ci.done": "{title} · done", "ci.nextCheckIn": "Next check-in {day}.", "ci.last": "That was your last check-in. Message your care team any time.",
    "ci.seconds": "{title} · 10 seconds", "ci.fromTeam": "From your care team", "ci.readReply": "Read and reply",
    "ci.allSet": "You're all set", "ci.nextAsk": "Next check-in {day}. We'll ask how you're feeling.",
    "ci.allDone": "Your check-ins are done. Message your care team any time.", "ci.willAsk": "We'll ask how you're feeling on day 2 and day 7 after you go home.",
    "ci.sayIt": "Say it instead", "ci.listening": "Listening… say it your way",
    "ci.title": "Check-ins", "ci.youSaid": "You said “{text}”", "ci.answerNow": "Answer now", "ci.message": "Message your care team",
  },
  ms: {
    "ci.thanks": "Terima kasih", "ci.willSee": "Pasukan penjagaan anda akan melihatnya hari ini.",
    "ci.told": "Pasukan penjagaan anda sudah dimaklumkan", "ci.callAbout": "Mereka akan menelefon anda hari ini tentang: {about}.", "ci.call": "Mereka akan menelefon anda hari ini.",
    "ci.waiting": "Menunggu jawapan anda", "ci.coming": "Akan datang {day}", "ci.allFine": "Semua baik · pasukan penjagaan anda boleh melihatnya",
    "ci.followedUp": "Pasukan penjagaan anda sudah membuat susulan", "ci.wasTold": "Pasukan penjagaan anda sudah dimaklumkan",
    "ci.noneYet": "Belum ada. Kami akan bertanya pada hari ke-2 dan hari ke-7 selepas anda pulang.", "ci.answered": "{n} daripada {of} dijawab",
    "ci.oneWaiting": " · satu menunggu anda", "ci.nextOn": " · seterusnya {day}",
    "ci.today": "Hari ini", "ci.couldNotLoad": "Semakan anda tidak dapat dimuatkan. Cuba lagi sebentar.", "ci.past": "Semakan lepas",
    "ci.done": "{title} · selesai", "ci.nextCheckIn": "Semakan seterusnya {day}.", "ci.last": "Itu semakan terakhir anda. Mesej pasukan penjagaan anda bila-bila masa.",
    "ci.seconds": "{title} · 10 saat", "ci.fromTeam": "Daripada pasukan penjagaan anda", "ci.readReply": "Baca dan balas",
    "ci.allSet": "Semua beres", "ci.nextAsk": "Semakan seterusnya {day}. Kami akan tanya keadaan anda.",
    "ci.allDone": "Semakan anda sudah selesai. Mesej pasukan penjagaan anda bila-bila masa.", "ci.willAsk": "Kami akan tanya keadaan anda pada hari ke-2 dan hari ke-7 selepas anda pulang.",
    "ci.sayIt": "Cakap sahaja", "ci.listening": "Sedang mendengar… cakaplah dengan cara anda",
    "ci.title": "Semakan", "ci.youSaid": "Anda kata “{text}”", "ci.answerNow": "Jawab sekarang", "ci.message": "Mesej pasukan penjagaan anda",
  },
  zh: {
    "ci.thanks": "谢谢您", "ci.willSee": "医护团队今天会看到。",
    "ci.told": "已通知您的医护团队", "ci.callAbout": "他们今天会打电话给您，关于：{about}。", "ci.call": "他们今天会打电话给您。",
    "ci.waiting": "等您回答", "ci.coming": "{day}进行", "ci.allFine": "一切正常 · 医护团队可以看到",
    "ci.followedUp": "医护团队已跟进", "ci.wasTold": "已通知医护团队",
    "ci.noneYet": "还没有。回家后第2天和第7天我们会问候您。", "ci.answered": "已回答 {n}/{of}",
    "ci.oneWaiting": " · 有一个等您回答", "ci.nextOn": " · 下次 {day}",
    "ci.today": "今天", "ci.couldNotLoad": "回访加载不了，请稍后再试。", "ci.past": "以往回访",
    "ci.done": "{title} · 已完成", "ci.nextCheckIn": "下次回访：{day}。", "ci.last": "这是最后一次回访。随时可以给医护团队留言。",
    "ci.seconds": "{title} · 10秒钟", "ci.fromTeam": "来自医护团队", "ci.readReply": "查看并回复",
    "ci.allSet": "都好了", "ci.nextAsk": "下次回访：{day}。我们会问您感觉怎么样。",
    "ci.allDone": "回访都完成了。随时可以给医护团队留言。", "ci.willAsk": "回家后第2天和第7天，我们会问您感觉怎么样。",
    "ci.sayIt": "用说的", "ci.listening": "正在听…请随意说",
    "ci.title": "回访", "ci.youSaid": "您说“{text}”", "ci.answerNow": "现在回答", "ci.message": "给医护团队留言",
  },
});
