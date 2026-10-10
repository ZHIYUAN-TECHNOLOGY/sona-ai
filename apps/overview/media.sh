#!/usr/bin/env bash
# Builds ./media from the pitch showcase videos: trims each clip's 4.5 s title card (the page titles it),
# cuts frames that show base model names, re-encodes for the web and writes a poster frame.
# The Worker serves ./media from the R2 bucket sona-overview-media, so upload what you build.
# Usage: bash media.sh [id ...]            build (no ids = all; existing outputs are skipped)
#        bash media.sh --upload [file ...]  upload to R2 (no files = everything in ./media)
set -euo pipefail
O="$(dirname "$0")/media"; mkdir -p "$O"
if [[ "${1:-}" == "--upload" ]]; then
  shift; cd "$O"; [[ $# -gt 0 ]] || set -- *
  for f in "$@"; do
    case $f in *.mp4) t=video/mp4;; *.jpg) t=image/jpeg;; *.svg) t=image/svg+xml;; *.png) t=image/png;; *) continue;; esac
    for try in 1 2 3; do bunx wrangler r2 object put "sona-overview-media/media/$f" --file "$f" --content-type "$t" \
      --cache-control "public, max-age=86400" --remote >/dev/null 2>&1 && break; [[ $try == 3 ]] && echo "failed $f"; sleep 2; done
  done; exit
fi
B=~/Documents/sona-ai/pitch/showcase-videos
K=~/Documents/sona-ai/pitch/semifinal-kit/04-media/videos
A=~/Documents/sona-ai/pitch/semifinal-kit/04-media/architecture
R=~/Documents/sona-ai/pitch/rerecord-2026-10-10   # 10 Oct re-recordings with the new Sona Care orb
cp "$A"/0{1,2,3}-*.dark.svg "$O/"
[[ -f "$O/orb.png" ]] || sips -Z 336 ~/Documents/sona-ai/pitch/semifinal-kit/04-media/brand/orb.png --out "$O/orb.png" >/dev/null   # hero logo: Sona Care resting pearl
for m in jay-ng wilfred-foo; do [[ -f "$O/$m.jpg" ]] || sips -s format jpeg -Z 480 ~/Documents/sona-ai/pitch/semifinal-kit/05-team/$m.png --out "$O/$m.jpg" >/dev/null; done

# id | source | start s | end s (empty = to the end) | poster s (empty = 45% in)
while IFS='|' read -r id src start end pt; do
  [[ -z "$id" || "$id" == \#* ]] && continue
  [[ $# -gt 0 && ! " $* " =~ " $id " ]] && continue
  [[ -f "$O/$id.mp4" ]] && continue
  src="${src/#B/$B}"; src="${src/#K/$K}"; src="${src/#R/$R}"
  [[ -f "$src" ]] || { echo "missing $src (skipped $id)"; continue; }
  to=(); [[ -n "$end" ]] && to=(-to "$end")
  ffmpeg -nostdin -loglevel error -y -ss "$start" ${to[@]+"${to[@]}"} -i "$src" -c:v libx264 -preset slow -crf 26 -vf "scale='min(1600,iw)':-2,format=yuv420p" \
    -c:a aac -b:a 96k -movflags +faststart "$O/$id.mp4"
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$O/$id.mp4")
  ffmpeg -nostdin -loglevel error -y -ss "${pt:-$(echo "$d * 0.45" | bc)}" -i "$O/$id.mp4" -frames:v 1 -vf scale=960:-2 -q:v 4 "$O/$id.jpg"
  printf '%-16s %5.1fs\n' "$id" "$d"
done <<'LIST'
film|B/10-wow-flow-v3/00-wow-flow-v3-full.mp4|0||200
scribe|R/7-consultation-scribe/four-voices-one-take.mp4|0|
scribe-record|B/7-consultation-scribe/01-record-the-consultation.mp4|4.5|
scribe-who|B/7-consultation-scribe/02-who-said-what.mp4|4.5|
scribe-note|B/7-consultation-scribe/03-note-from-the-consultation.mp4|4.5|
voice|R/6-voice-speech-to-speech/00-four-calls-in-one.mp4|0|
voice-allergy|R/6-voice-speech-to-speech/01-allergy-from-her-record.mp4|4.5|
voice-malay|R/6-voice-speech-to-speech/02-malay-her-medicines.mp4|4.5|
voice-chinese|R/6-voice-speech-to-speech/03-chinese-recovery-advice.mp4|4.5|
voice-general|R/6-voice-speech-to-speech/04-a-general-question.mp4|4.5|
care-orb|B/13-orb-trial/pearl-to-folding-light-16x9.mp4|0||9
day2|R/deck/day2-call.mp4|0|
home-discharge|B/10-wow-flow-v3/05-discharge.mp4|4.5|
home-call|R/deck/day2-call.mp4|4.5|
home-staff|B/10-wow-flow-v3/07-staff-see-it.mp4|4.5|
home-phone|B/2-cross-app-sona-care-and-sona-pro/01-discharge.mp4|4.5|
home-checkin|R/2-cross-app-sona-care-and-sona-pro/02-day2-checkin.mp4|4.5|
home-urgent|R/2-cross-app-sona-care-and-sona-pro/03-urgent-message.mp4|4.5||57
home-booked|B/2-cross-app-sona-care-and-sona-pro/04-book-in.mp4|4.5|
gl|B/10-wow-flow-v3/04-guarantee-letter.mp4|4.5|
gl-web|B/8-web-sona-pro/05-guarantee-letter-end-to-end.mp4|4.5|
xray|B/10-wow-flow-v3/03-xray.mp4|4.5|
xray-web|B/8-web-sona-pro/03-xray-film-in-the-answer.mp4|4.5|
evidence|K/demo-evidence.mp4|0|
ev-pubmed|B/3-sona-pro-clinician/04-evidence-with-pubmed-citations.mp4|4.5|66
ev-patient|B/3-sona-pro-clinician/05-evidence-for-this-patient.mp4|4.5|62
ev-web|B/8-web-sona-pro/04-evidence-with-citations.mp4|4.5|
ops-today|B/8-web-sona-pro/01-today-what-needs-me-first.mp4|4.5|
ops-web|B/12-web-ops-and-privacy/01-ward-tasks-handover.mp4|4.5|
ops-myday|B/4-sona-pro-hospital-operations/01-my-day-who-needs-me.mp4|4.5|
ops-ward|B/4-sona-pro-hospital-operations/02-ward-command-and-huddle-brief.mp4|4.5|24
ops-bed|B/4-sona-pro-hospital-operations/04-discharge-bed-freed.mp4|4.5|
ops-handover|B/4-sona-pro-hospital-operations/05-shift-handover.mp4|4.5|
ops-lab|B/4-sona-pro-hospital-operations/06-critical-lab-result-live.mp4|4.5|
ops-manager|B/4-sona-pro-hospital-operations/07-manager-view.mp4|4.5|
ops-nurse|B/4-sona-pro-hospital-operations/13-nurse-view.mp4|4.5|
cl-visit|B/8-web-sona-pro/02-visit-page-sona-knows-amelia.mp4|4.5|
cl-ask|B/3-sona-pro-clinician/01-ask-sona-brief-me.mp4|4.5|26
cl-reason|B/3-sona-pro-clinician/03-clinical-reasoning.mp4|4.5|50
cl-hand|B/3-sona-pro-clinician/07-scan-handwritten-note.mp4|4.5||38
cl-rx|B/3-sona-pro-clinician/08-safe-prescription.mp4|4.5|
cl-dose|B/14-problem-proofs/wrong-dose-stopped.mp4|4.5|
cl-discharge|B/8-web-sona-pro/06-discharge-plan-and-readiness.mp4|4.5|
care-web-day|B/9-web-sona-care/01-sign-in-her-day-and-medicines.mp4|4.5|
care-web-ask|B/9-web-sona-care/02-ask-sona-from-her-record-and-in-malay.mp4|4.5|
care-web-plan|B/9-web-sona-care/03-discharge-plan-warning-signs-and-pdf.mp4|4.5|
care-plan|B/5-sona-care-patient/01-her-plan-and-medicines.mp4|4.5|
care-record|R/5-sona-care-patient/02-answer-from-her-record.mp4|4.5|
care-worry|R/5-sona-care-patient/03-when-to-worry.mp4|4.5|
care-dose|B/5-sona-care-patient/04-dose-taken.mp4|4.5|
care-photo|B/5-sona-care-patient/05-is-this-my-medicine.mp4|4.5|
care-leaflet|B/5-sona-care-patient/06-leaflet-in-her-language.mp4|4.5|
care-malay|R/5-sona-care-patient/08-in-malay.mp4|4.5|
care-chinese|R/5-sona-care-patient/09-in-chinese.mp4|4.5|
care-doctor|R/5-sona-care-patient/10-which-doctor.mp4|4.5|
care-book|B/5-sona-care-patient/11-book-a-follow-up.mp4|4.5|
care-summary|B/14-problem-proofs/health-summary-to-another-hospital.mp4|4.5|
privacy|B/12-web-ops-and-privacy/02-privacy-de-identified.mp4|4.5|
LIST
